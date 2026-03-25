const Category = require("../models/category.model");
const asyncHandler = require("../utils/asyncHandler");
const ApiError = require("../utils/ApiError");
const ApiResponse = require("../utils/ApiResponse");

exports.createCategory = asyncHandler(async (req, res) => {
  const category = await Category.create({
    ...req.body,
  });

  res
    .status(201)
    .json(new ApiResponse(201, "Category created successfully", category));
});

exports.getCategory = asyncHandler(async (req, res) => {
  const categories = await Category.find({ isActive: true })
    .populate("parent", "name slug")
    .populate("subCategories");

  res
    .status(200)
    .json(new ApiResponse(200, "Categories fetched successfully", categories));
});

exports.getSingleCategory = asyncHandler(async (req, res) => {
  const category = await Category.find({
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

exports.updateCategory = asyncHandler(async (req, res) => {
  const category = await Category.findOne({ slug: req.params.slug });

  if (!category) {
    throw new ApiError(404, "Category not found");
  }

  Object.assign(category, req.body);
  await category.save();

  res
    .status(200)
    .json(new ApiResponse(200, "Category updated successfully", category));
});

exports.deleteCategory = asyncHandler(async (req, res) => {
  const category = await Category.findOne({ slug: req.params.slug });

  if (!category) {
    throw new ApiError(404, "Category not found");
  }

  category.isActive = false;
  await category.save();

  res
    .status(200)
    .json(new ApiResponse(200, "Category deleted successfully", category));
});
