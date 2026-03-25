const express = require("express");
const {
  createCategory,
  getCategory,
  getSingleCategory,
  updateCategory,
  deleteCategory,
} = require("../controllers/category.controller");
const { protect, isAdmin } = require("../middlewares/auth.middleware");
const router = express.Router();

router.route("/").get(getCategory).post(protect, isAdmin, createCategory);
router
  .route("/:slug")
  .get(getSingleCategory)
  .put(protect, isAdmin, updateCategory)
  .delete(protect, isAdmin, deleteCategory);

module.exports = router;
