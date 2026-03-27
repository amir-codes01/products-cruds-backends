const jwt = require("jsonwebtoken");
const ApiError = require("../utils/ApiError");
const User = require("../models/user.model");
const asyncHandler = require("../utils/asyncHandler");

const protect = asyncHandler(async (req, res, next) => {
  const accessToken =
    req.cookies?.accessToken ||
    req.header("Authorization")?.replace("Bearer ", "");

  if (!accessToken) {
    throw new ApiError(401, "Not authorized");
  }
  const decoded = await jwt.verify(accessToken, process.env.JWT_ACCESS_SECRET);

  const user = await User.findById(decoded.id).select("-password");

  if (!user) {
    throw new ApiError(401, "Not authorized");
  }

  req.user = user;
  next();
});

const isAdmin = asyncHandler(async (req, res, next) => {
  if (!req.user || req.user.role !== "admin") {
    throw new ApiError(403, "Access denied. Admins only.");
  }

  next();
});

const checkRole = (...permittedRoles) => {
  return asyncHandler(async (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ message: "Not authenticated" });
    }

    if (!permittedRoles.includes(req.user.role)) {
      return res
        .status(403)
        .json({ message: "Forbidden: Insufficient permissions" });
    }
    next();
  });
};

module.exports = { protect, isAdmin, checkRole };
