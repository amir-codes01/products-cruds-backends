const express = require("express");
const {
  createCategory,
  getCategory,
  getSingleCategory,
  updateCategory,
  deleteCategory,
} = require("../controllers/category.controller");
const {
  protect,
  isAdmin,
  checkRole,
} = require("../middlewares/auth.middleware");
const router = express.Router();

router
  .route("/")
  .get(getCategory)
  .post(protect, checkRole("admin", "superadmin"), createCategory);
router
  .route("/:slug")
  .get(getSingleCategory)
  .put(protect, checkRole("admin", "superadmin"), updateCategory)
  .delete(protect, checkRole("admin", "superadmin"), deleteCategory);

module.exports = router;
