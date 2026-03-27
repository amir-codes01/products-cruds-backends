const express = require("express");
const {
  createCategory,
  getCategory,
  getSingleCategory,
  updateCategory,
  deleteCategory,
} = require("../controllers/category.controller");
const { protect, checkRole } = require("../middlewares/auth.middleware");
const { uploadCategory } = require("../config/cloudinary.config");

const router = express.Router();

router.route("/").get(getCategory).post(
  protect,
  checkRole("admin", "superadmin"),
  uploadCategory.single("image"), // Use category-specific upload
  createCategory,
);

router
  .route("/:slug")
  .get(getSingleCategory)
  .put(
    protect,
    checkRole("admin", "superadmin"),
    uploadCategory.single("image"),
    updateCategory,
  )
  .delete(protect, checkRole("admin", "superadmin"), deleteCategory);

module.exports = router;
