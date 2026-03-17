const User = require("../models/user.model");
const ApiError = require("../utils/ApiError");
const ApiResponse = require("../utils/ApiResponse");
const asyncHandler = require("../utils/asyncHandler");
const jwt = require("jsonwebtoken");
const AuditLog = require("../models/audit.model");

const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    throw new ApiError(400, "All fields are required");
  }

  const user = await User.findOne({ email: email.toLowerCase() }).select(
    "+password",
  );

  if (!user) {
    await AuditLog.create({
      action: "USER_LOGIN_FAILED",
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
      metadata: { email },
    });

    throw new ApiError(401, "Invalid credentials");
  }

  const isMatch = await user.comparePassword(password);

  if (!isMatch) {
    throw new ApiError(401, "Invalid credentials");
  }

  if (user.status !== "active") {
    throw new ApiError(403, "Account suspended");
  }

  const accessToken = user.generateAccessToken();
  const refreshToken = user.generateRefreshToken();

  user.refreshToken = refreshToken;

  await user.save({ validateBeforeSave: false });

  await AuditLog.create({
    user: user._id,
    action: "USER_LOGIN",
    ipAddress: req.ip,
    userAgent: req.headers["user-agent"],
  });

  res
    .cookie("accessToken", accessToken, {
      httpOnly: true,
      secure: true,
      sameSite: "strict",
      maxAge: 15 * 60 * 1000,
    })
    .cookie("refreshToken", refreshToken, {
      httpOnly: true,
      secure: true,
      sameSite: "strict",
      maxAge: 7 * 24 * 60 * 60 * 1000,
    })
    .status(200)
    .json(
      new ApiResponse(200, "User logged in successfully", {
        accessToken,
        user: {
          id: user._id,
          username: user.username,
          email: user.email,
          role: user.role,
        },
      }),
    );
});

const refreshToken = asyncHandler(async (req, res) => {
  const incommingRefreshToken = req.cookies.refreshToken;

  if (!incommingRefreshToken) {
    throw new ApiError(401, "Unauthorized");
  }

  const decoded = jwt.verify(
    incommingRefreshToken,
    process.env.JWT_REFRESH_SECRET,
  );

  const user = await User.findById(decoded.id);

  if (!user || incommingRefreshToken !== user.refreshToken) {
    throw new ApiError(401, "Invalid refresh token");
  }

  const newAccessToken = user.generateAccessToken();
  const newRefreshToken = user.generateRefreshToken();

  user.refreshToken = newRefreshToken;
  await user.save({ validateBeforeSave: false });

  res
    .cookie("accessToken", newAccessToken, {
      httpOnly: true,
      secure: true,
      sameSite: "strict",
      maxAge: 15 * 60 * 1000,
    })
    .cookie("refreshToken", newRefreshToken, {
      httpOnly: true,
      secure: true,
      sameSite: "strict",
      maxAge: 7 * 24 * 60 * 60 * 1000,
    })
    .status(200)
    .json(new ApiResponse(200, "Token refreshed", accessToken));
});

const logout = asyncHandler(async (req, res) => {
  const refreshToken = req.cookies.refreshToken;
  let userId = null;

  if (refreshToken) {
    try {
      const decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);
      if (decoded?.id) {
        userId = decoded.id;
        await User.findByIdAndUpdate(decoded.id, {
          $unset: { refreshToken: 1 },
        });
      }
    } catch (err) {
      // Invalid refresh token, continue with logout anyway
      console.warn("Invalid refresh token during logout:", err.message);
    }
  }

  if (userId) {
    await AuditLog.create({
      user: userId,
      action: "USER_LOGOUT",
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
    });
  }

  res
    .clearCookie("accessToken")
    .clearCookie("refreshToken")
    .status(200)
    .json(new ApiResponse(200, "Logged out successfully"));
});

module.exports = { login, refreshToken, logout };
