const express = require("express");
const {
  createProduct,
  getProducts,
  getSingleProduct,
  updateProduct,
  deleteProduct,
  hardDeleteProduct,
  addProductImages,
  removeProductImages,
  reorderProductImages,
  setPrimaryImage,
} = require("../controllers/product.controller");
const { protect, checkRole } = require("../middlewares/auth.middleware");
const { uploadProduct } = require("../config/cloudinary.config");

const router = express.Router();

// Public routes
router.route("/").get(getProducts);
router.route("/:slug").get(getSingleProduct);

// Admin routes with image upload
router.route("/").post(
  protect,
  checkRole("admin", "superadmin"),
  uploadProduct.array("images", 10), // Allow up to 10 images, field name 'images'
  createProduct,
);

router
  .route("/:slug")
  .put(
    protect,
    checkRole("admin", "superadmin"),
    uploadProduct.array("images", 10), // Allow adding up to 10 new images during update
    updateProduct,
  )
  .delete(protect, checkRole("admin", "superadmin"), deleteProduct);

// Additional image management routes
router
  .route("/:slug/images")
  .post(
    protect,
    checkRole("admin", "superadmin"),
    uploadProduct.array("images", 10),
    addProductImages,
  )
  .delete(protect, checkRole("admin", "superadmin"), removeProductImages);

router
  .route("/:slug/images/reorder")
  .put(protect, checkRole("admin", "superadmin"), reorderProductImages);

router
  .route("/:slug/images/primary")
  .put(protect, checkRole("admin", "superadmin"), setPrimaryImage);

router
  .route("/:slug/hard-delete")
  .delete(protect, checkRole("admin", "superadmin"), hardDeleteProduct);

module.exports = router;
