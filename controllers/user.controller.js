const User = require("../models/user.model");
const ApiError = require("../utils/ApiError");
const ApiResponse = require("../utils/ApiResponse");
const asyncHandler = require("../utils/asyncHandler");
const AuditLog = require("../models/audit.model");

const register = asyncHandler(async (req, res, next) => {
  const { username, password, email } = req.body;

  if (!username || !password || !email) {
    throw new ApiError(400, "All field are required");
  }

  const existingUser = await User.findOne({ $or: [{ email }, { username }] });

  if (existingUser) {
    throw new ApiError(400, "User already exist ");
  }

  const user = await User.create({
    username,
    password,
    email,
  });

  await AuditLog.create({
    user: user._id,
    action: "USER_REGISTER",
    ipAddress: req.ip,
    userAgent: req.headers["user-agent"],
    metadata: {
      email: user.email,
    },
  });

  return res.status(201).json(
    new ApiResponse(201, "User created successfully", {
      id: user._id,
      username: user.username,
      email: user.email,
    }),
  );
});

const getSingleUser = asyncHandler(async (req, res) => {
  res.status(200).json(
    new ApiResponse(200, "User get successfully", {
      id: req.user._id,
      username: req.user.username,
      email: req.user.email,
      role: req.user.role,
    }),
  );
});

const updateSingleUser = asyncHandler(async (req, res) => {
  const { userId } = req.params;

  if (!userId) {
    throw new ApiError(400, "User ID is required");
  }

  const allowedFields = ["username", "email", "role", "status"];
  const updates = {};

  for (const key of allowedFields) {
    if (req.body[key] !== undefined) {
      updates[key] = req.body[key];
    }
  }

  if (Object.keys(updates).length === 0) {
    throw new ApiError(400, "No valid fields to update");
  }

  // 🔍 Get old user for audit comparison
  const existingUser = await User.findById(userId);
  if (!existingUser) {
    throw new ApiError(404, "User not found");
  }

  const updatedUser = await User.findByIdAndUpdate(userId, updates, {
    new: true,
    runValidators: true,
  });

  // 🧾 Create audit log
  await AuditLog.create({
    user: req.user.id, // admin performing action
    targetUser: userId, // affected user
    action: "UPDATE_USER",
    ipAddress: req.ip,
    userAgent: req.headers["user-agent"],
    metadata: {
      before: {
        username: existingUser.username,
        email: existingUser.email,
        role: existingUser.role,
        isActive: existingUser.isActive,
      },
      after: updates,
    },
  });

  return res
    .status(200)
    .json(new ApiResponse(200, "User updated successfully", updatedUser));
});

const deleteUser = asyncHandler(async (req, res) => {
  const { userId } = req.params;

  if (!userId) {
    throw new ApiError(400, "User ID is required");
  }

  const existingUser = await User.findById(userId);
  if (!existingUser) {
    throw new ApiError(404, "User not found");
  }

  if (req.user.id === userId) {
    throw new ApiError(400, "You cannot delete your own account");
  }

  if (existingUser.role === "superadmin") {
    throw new ApiError(403, "Cannot delete super admin");
  }

  const deletedUser = await User.findByIdAndDelete(userId);

  // 🧾 Audit log (non-blocking)
  AuditLog.create({
    user: req.user.id,
    targetUser: userId,
    action: "DELETE_USER",
    ipAddress: req.ip,
    userAgent: req.headers["user-agent"],
    metadata: {
      email: existingUser.email,
      username: existingUser.username,
    },
  }).catch((err) => {
    console.error("Audit log failed:", err);
  });

  return res.status(200).json(
    new ApiResponse(200, "User deleted successfully", {
      id: existingUser._id,
    }),
  );
});

const updateProfile = asyncHandler(async (req, res) => {
  const userId = req.user._id;

  const allowedFields = ["username", "email"];
  const updates = {};

  allowedFields.forEach((field) => {
    if (req.body[field] !== undefined) {
      updates[field] = req.body[field];
    }
  });

  if (Object.keys(updates).length === 0) {
    throw new ApiError(400, "No valid fields provided for update");
  }

  const user = await User.findById(userId);

  if (!user) {
    throw new ApiError(404, "User not found");
  }

  const oldUser = user.toObject();

  if (
    (updates.email && updates.email !== user.email) ||
    (updates.username && updates.username !== user.username)
  ) {
    const existingUser = await User.findOne({
      $or: [
        updates.email ? { email: updates.email } : null,
        updates.username ? { username: updates.username } : null,
      ].filter(Boolean),
      _id: { $ne: userId },
    });

    if (existingUser) {
      throw new ApiError(400, "Email or username already in use");
    }
  }

  Object.assign(user, updates);
  await user.save();

  const newUser = user.toObject();

  const changedFields = {};

  Object.keys(updates).forEach((key) => {
    if (oldUser[key] !== newUser[key]) {
      changedFields[key] = {
        oldValue: oldUser[key],
        newValue: newUser[key],
      };
    }
  });

  if (Object.keys(changedFields).length > 0) {
    await AuditLog.create({
      user: user._id,
      action: "USER_PROFILE_UPDATED",
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
      metadata: {
        changes: changedFields,
      },
    });
  }

  return res.status(200).json(
    new ApiResponse(200, "Profile updated successfully", {
      id: user._id,
      username: user.username,
      email: user.email,
    }),
  );
});

const changePassword = asyncHandler(async (req, res) => {
  const userId = req.user._id;
  const { currentPassword, newPassword } = req.body;

  if (!currentPassword || !newPassword) {
    throw new ApiError(400, "Both current and new password are required");
  }

  if (newPassword.length < 6) {
    throw new ApiError(400, "New password must be at least 6 characters");
  }

  // Select password explicitly because it's select:false in schema
  const user = await User.findById(userId).select("+password");

  if (!user) {
    throw new ApiError(404, "User not found");
  }

  // 1️⃣ Verify current password
  const isMatch = await user.comparePassword(currentPassword);

  if (!isMatch) {
    await AuditLog.create({
      user: userId,
      action: "PASSWORD_CHANGE_FAILED",
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
    });

    throw new ApiError(401, "Current password is incorrect");
  }

  // 2️⃣ Prevent same password reuse
  const isSamePassword = await user.comparePassword(newPassword);

  if (isSamePassword) {
    throw new ApiError(
      400,
      "New password must be different from current password",
    );
  }

  // 3️⃣ Set new password (auto-hashed by pre-save hook)
  user.password = newPassword;

  // 4️⃣ Invalidate refresh token (force re-login everywhere)
  user.refreshToken = undefined;

  await user.save();

  // 5️⃣ Audit success
  await AuditLog.create({
    user: userId,
    action: "PASSWORD_CHANGED",
    ipAddress: req.ip,
    userAgent: req.headers["user-agent"],
  });

  // 6️⃣ Clear cookies (force logout on current device too)
  res
    .clearCookie("accessToken")
    .clearCookie("refreshToken")
    .status(200)
    .json(
      new ApiResponse(
        200,
        "Password changed successfully. Please login again.",
      ),
    );
});

const getAllUsers = asyncHandler(async (req, res) => {
  const user = await User.find();
  res.status(200).json(new ApiResponse(200, "users get successfully", user));
});

module.exports = {
  register,
  updateProfile,
  getSingleUser,
  changePassword,
  getAllUsers,
  updateSingleUser,
  deleteUser,
};
