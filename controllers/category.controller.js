const Category = require("../models/category.model");
const asyncHandler = require("../utils/asyncHandler");
const ApiError = require("../utils/ApiError");
const ApiResponse = require("../utils/ApiResponse");
const { cloudinary } = require("../config/cloudinary.config");

// Create category with image upload
exports.createCategory = asyncHandler(async (req, res) => {
  // Check if file was uploaded
  let imageData = {};

  if (req.file) {
    imageData = {
      url: req.file.path, // Cloudinary URL
      public_id: req.file.filename, // Cloudinary public ID for future operations
    };
  }

  const category = await Category.create({
    ...req.body,
    image: imageData,
  });

  res
    .status(201)
    .json(new ApiResponse(201, "Category created successfully", category));
});

// Get all categories (unchanged)
exports.getCategory = asyncHandler(async (req, res) => {
  const categories = await Category.find({ isActive: true })
    .populate("parent", "name slug image")
    .populate("subCategories");

  res
    .status(200)
    .json(new ApiResponse(200, "Categories fetched successfully", categories));
});

// Get single category (unchanged)
exports.getSingleCategory = asyncHandler(async (req, res) => {
  const category = await Category.findOne({
    slug: req.params.slug,
    isActive: true,
  });

  if (!category) {
    throw new ApiError(404, "Category not found");
  }

  res
    .status(200)
    .json(new ApiResponse(200, "Category found successfully", category));
});

// Update category with image handling
exports.updateCategory = asyncHandler(async (req, res) => {
  const category = await Category.findOne({ slug: req.params.slug });

  if (!category) {
    throw new ApiError(404, "Category not found");
  }

  // Handle image upload if new image is provided
  if (req.file) {
    // Delete old image from Cloudinary if exists
    if (category.image && category.image.public_id) {
      try {
        await cloudinary.uploader.destroy(category.image.public_id);
      } catch (error) {
        console.error("Error deleting old image:", error);
        // Continue even if deletion fails
      }
    }

    // Update with new image
    req.body.image = {
      url: req.file.path,
      public_id: req.file.filename,
    };
  }

  // Update category fields
  Object.assign(category, req.body);
  await category.save();

  res
    .status(200)
    .json(new ApiResponse(200, "Category updated successfully", category));
});

// Delete category (soft delete) with optional image deletion
exports.deleteCategory = asyncHandler(async (req, res) => {
  const category = await Category.findOne({ slug: req.params.slug });

  if (!category) {
    throw new ApiError(404, "Category not found");
  }

  // Option 1: Just soft delete (keep image)
  category.isActive = false;
  await category.save();

  // Option 2: Also delete image from Cloudinary (uncomment if you want this)
  // if (category.image && category.image.public_id) {
  //   try {
  //     await cloudinary.uploader.destroy(category.image.public_id);
  //   } catch (error) {
  //     console.error("Error deleting image:", error);
  //   }
  // }

  res
    .status(200)
    .json(new ApiResponse(200, "Category deleted successfully", category));
});

// Hard delete category (completely remove from database and Cloudinary)
exports.hardDeleteCategory = asyncHandler(async (req, res) => {
  const category = await Category.findOne({ slug: req.params.slug });

  if (!category) {
    throw new ApiError(404, "Category not found");
  }

  // Delete image from Cloudinary if exists
  if (category.image && category.image.public_id) {
    try {
      await cloudinary.uploader.destroy(category.image.public_id);
    } catch (error) {
      console.error("Error deleting image:", error);
    }
  }

  // Delete category from database
  await category.deleteOne();

  res
    .status(200)
    .json(new ApiResponse(200, "Category permanently deleted successfully"));
});

// Optional: Delete category image only
exports.deleteCategoryImage = asyncHandler(async (req, res) => {
  const category = await Category.findOne({ slug: req.params.slug });

  if (!category) {
    throw new ApiError(404, "Category not found");
  }

  if (!category.image || !category.image.public_id) {
    throw new ApiError(404, "No image found for this category");
  }

  // Delete image from Cloudinary
  await cloudinary.uploader.destroy(category.image.public_id);

  // Remove image reference from category
  category.image = undefined;
  await category.save();

  res
    .status(200)
    .json(new ApiResponse(200, "Category image deleted successfully"));
});
