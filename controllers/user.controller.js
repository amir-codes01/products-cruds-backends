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
  const user = await User.find({ status: "active" });
  res.status(200).json(new ApiResponse(200, "users get successfully", user));
});

module.exports = {
  register,
  updateProfile,
  getSingleUser,
  changePassword,
  getAllUsers,
};
