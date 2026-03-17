const express = require("express");
const router = express.Router();

const {
  login,
  refreshToken,
  logout,
} = require("../controllers/auth.controller");

const {
  register,
  updateProfile,
  getSingleUser,
  changePassword,
  getAllUsers,
} = require("../controllers/user.controller");

const { protect } = require("../middlewares/auth.middleware");

// AUTH Routes
router.post("/register", register);
router.post("/login", login);
router.post("/refreshtoken", refreshToken);
router.post("/logout", protect, logout);
router.put("/change-password", protect, changePassword);

// User profile routes
router.get("/me", protect, getSingleUser);
router.put("/me", protect, updateProfile);
router.get("/", getAllUsers);

module.exports = router;
