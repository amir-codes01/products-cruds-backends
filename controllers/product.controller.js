const Product = require("../models/product.model");
const asyncHandler = require("../utils/asyncHandler");
const ApiError = require("../utils/ApiError");
const ApiResponse = require("../utils/ApiResponse");
const AuditLog = require("../models/audit.model");
const { cloudinary } = require("../config/cloudinary.config");

// Helper function to upload multiple images to Cloudinary
const uploadMultipleImages = async (files) => {
  const imagePromises = files.map(async (file) => ({
    url: file.path,
    public_id: file.filename,
  }));

  return Promise.all(imagePromises);
};

// Helper function to delete multiple images from Cloudinary
const deleteMultipleImages = async (publicIds) => {
  const deletionPromises = publicIds.map(async (publicId) => {
    try {
      await cloudinary.uploader.destroy(publicId);
    } catch (error) {
      console.error(`Error deleting image ${publicId}:`, error);
    }
  });

  await Promise.all(deletionPromises);
};

// Create product with multiple images
exports.createProduct = asyncHandler(async (req, res) => {
  // Handle image uploads
  let imageData = [];

  if (req.files && req.files.length > 0) {
    imageData = await uploadMultipleImages(req.files);
  }

  const product = await Product.create({
    ...req.body,
    createdBy: req.user._id,
    images: imageData,
  });

  await AuditLog.create({
    user: req.user._id,
    action: "CREATE_PRODUCT",
    ipAddress: req.ip,
    userAgent: req.headers["user-agent"],
    metadata: {
      productId: product._id,
      productName: product.name,
      price: product.price,
      imageCount: imageData.length,
    },
  });

  res
    .status(201)
    .json(new ApiResponse(201, "Product created successfully", product));
});

// Get products with pagination and filtering
exports.getProducts = asyncHandler(async (req, res) => {
  const {
    page = 1,
    limit = 10,
    keyword,
    category,
    minPrice,
    maxPrice,
    rating,
    sortBy = "createdAt",
    order = "desc",
  } = req.query;

  const filter = { isActive: true };

  if (keyword) {
    filter.$or = [
      { name: { $regex: keyword, $options: "i" } },
      { description: { $regex: keyword, $options: "i" } },
      { brand: { $regex: keyword, $options: "i" } },
    ];
  }

  if (category) {
    filter.category = category;
  }

  if (minPrice || maxPrice) {
    filter.price = {};
    if (minPrice) filter.price.$gte = Number(minPrice);
    if (maxPrice) filter.price.$lte = Number(maxPrice);
  }

  if (rating) {
    filter.averageRating = { $gte: Number(rating) };
  }

  const sortOrder = order === "asc" ? 1 : -1;
  const sortOptions = { [sortBy]: sortOrder };

  const skip = (Number(page) - 1) * Number(limit);

  const products = await Product.find(filter)
    .populate("category", "name slug")
    .populate("createdBy", "username email")
    .sort(sortOptions)
    .skip(skip)
    .limit(Number(limit))
    .lean();

  const totalProducts = await Product.countDocuments(filter);

  res.status(200).json(
    new ApiResponse(200, "Products fetched successfully", {
      totalProducts,
      currentPage: Number(page),
      totalPages: Math.ceil(totalProducts / limit),
      products,
    }),
  );
});

// Get single product
exports.getSingleProduct = asyncHandler(async (req, res) => {
  const slug = req.params.slug;

  const product = await Product.findOne({ slug: slug, isActive: true })
    .populate("category", "name slug")
    .populate("createdBy", "username email")
    .populate({
      path: "reviews",
      select: "rating comment user",
      populate: {
        path: "user",
        select: "username",
      },
    });

  if (!product) {
    throw new ApiError(404, "Product not found");
  }

  res
    .status(200)
    .json(new ApiResponse(200, "Product found successfully", product));
});

// Update product with image management
exports.updateProduct = asyncHandler(async (req, res) => {
  const product = await Product.findOne({ slug: req.params.slug });

  if (!product) {
    throw new ApiError(404, "Product not found");
  }

  const oldValues = product.toObject();
  let changes = {};

  // Handle image operations
  if (req.body.removeImages && req.body.removeImages.length > 0) {
    // Remove specific images
    const imagesToRemove = product.images.filter((img) =>
      req.body.removeImages.includes(img.public_id),
    );

    if (imagesToRemove.length > 0) {
      const publicIdsToRemove = imagesToRemove.map((img) => img.public_id);
      await deleteMultipleImages(publicIdsToRemove);

      // Filter out removed images
      product.images = product.images.filter(
        (img) => !req.body.removeImages.includes(img.public_id),
      );

      changes.images = {
        oldValue: oldValues.images.length,
        newValue: product.images.length,
        removed: req.body.removeImages.length,
      };
    }
  }

  // Handle new image uploads
  if (req.files && req.files.length > 0) {
    const newImages = await uploadMultipleImages(req.files);
    product.images.push(...newImages);

    changes.images = {
      ...changes.images,
      added: req.files.length,
      total: product.images.length,
    };
  }

  // Update other fields
  const updatedFields = { ...req.body };
  delete updatedFields.removeImages; // Remove this from being directly assigned

  Object.assign(product, updatedFields);
  await product.save();

  const newValues = product.toObject();

  // Track field changes
  const changeFields = {};

  Object.keys(req.body).forEach((key) => {
    if (key !== "removeImages" && oldValues[key] !== newValues[key]) {
      changeFields[key] = {
        oldValue: oldValues[key],
        newValue: newValues[key],
      };
    }
  });

  // Add image changes if any
  if (Object.keys(changes).length > 0) {
    changeFields.imageChanges = changes;
  }

  // Create audit log if there are changes
  if (Object.keys(changeFields).length > 0) {
    await AuditLog.create({
      user: req.user._id,
      action: "UPDATE_PRODUCT",
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
      metadata: {
        productId: product._id,
        changes: changeFields,
      },
    });
  }

  res
    .status(200)
    .json(new ApiResponse(200, "Product updated successfully", product));
});

// Soft delete product (deactivate)
exports.deleteProduct = asyncHandler(async (req, res) => {
  const product = await Product.findOne({ slug: req.params.slug });

  if (!product) {
    throw new ApiError(404, "Product not found");
  }

  product.isActive = false;
  await product.save();

  await AuditLog.create({
    user: req.user._id,
    action: "DELETE_PRODUCT",
    ipAddress: req.ip,
    userAgent: req.headers["user-agent"],
    metadata: {
      productId: product._id,
      productName: product.name,
      price: product.price,
      imageCount: product.images.length,
    },
  });

  res
    .status(200)
    .json(new ApiResponse(200, "Product deactivated successfully", product));
});

// Hard delete product (permanent deletion with images)
exports.hardDeleteProduct = asyncHandler(async (req, res) => {
  const product = await Product.findOne({ slug: req.params.slug });

  if (!product) {
    throw new ApiError(404, "Product not found");
  }

  // Delete all images from Cloudinary
  if (product.images && product.images.length > 0) {
    const publicIds = product.images.map((img) => img.public_id);
    await deleteMultipleImages(publicIds);
  }

  // Delete product from database
  await product.deleteOne();

  await AuditLog.create({
    user: req.user._id,
    action: "HARD_DELETE_PRODUCT",
    ipAddress: req.ip,
    userAgent: req.headers["user-agent"],
    metadata: {
      productId: product._id,
      productName: product.name,
      deletedImages: product.images.length,
    },
  });

  res
    .status(200)
    .json(new ApiResponse(200, "Product permanently deleted successfully"));
});

// Add images to existing product
exports.addProductImages = asyncHandler(async (req, res) => {
  const product = await Product.findOne({ slug: req.params.slug });

  if (!product) {
    throw new ApiError(404, "Product not found");
  }

  if (!req.files || req.files.length === 0) {
    throw new ApiError(400, "No images provided");
  }

  const newImages = await uploadMultipleImages(req.files);
  product.images.push(...newImages);
  await product.save();

  await AuditLog.create({
    user: req.user._id,
    action: "ADD_PRODUCT_IMAGES",
    ipAddress: req.ip,
    userAgent: req.headers["user-agent"],
    metadata: {
      productId: product._id,
      addedImages: req.files.length,
      totalImages: product.images.length,
    },
  });

  res.status(200).json(
    new ApiResponse(200, "Images added successfully", {
      productId: product._id,
      images: product.images,
    }),
  );
});

// Remove specific images from product
exports.removeProductImages = asyncHandler(async (req, res) => {
  const product = await Product.findOne({ slug: req.params.slug });

  if (!product) {
    throw new ApiError(404, "Product not found");
  }

  const { imagePublicIds } = req.body;

  if (
    !imagePublicIds ||
    !Array.isArray(imagePublicIds) ||
    imagePublicIds.length === 0
  ) {
    throw new ApiError(400, "Please provide image public_ids to remove");
  }

  // Find images to remove
  const imagesToRemove = product.images.filter((img) =>
    imagePublicIds.includes(img.public_id),
  );

  if (imagesToRemove.length === 0) {
    throw new ApiError(404, "No matching images found");
  }

  // Delete from Cloudinary
  await deleteMultipleImages(imagePublicIds);

  // Remove from product
  product.images = product.images.filter(
    (img) => !imagePublicIds.includes(img.public_id),
  );
  await product.save();

  await AuditLog.create({
    user: req.user._id,
    action: "REMOVE_PRODUCT_IMAGES",
    ipAddress: req.ip,
    userAgent: req.headers["user-agent"],
    metadata: {
      productId: product._id,
      removedImages: imagesToRemove.length,
      remainingImages: product.images.length,
    },
  });

  res.status(200).json(
    new ApiResponse(200, "Images removed successfully", {
      productId: product._id,
      remainingImages: product.images.length,
      images: product.images,
    }),
  );
});

// Reorder product images
exports.reorderProductImages = asyncHandler(async (req, res) => {
  const product = await Product.findOne({ slug: req.params.slug });

  if (!product) {
    throw new ApiError(404, "Product not found");
  }

  const { imageOrder } = req.body;

  if (!imageOrder || !Array.isArray(imageOrder) || imageOrder.length === 0) {
    throw new ApiError(400, "Please provide image order array");
  }

  // Reorder images based on provided public_id order
  const reorderedImages = [];
  for (const publicId of imageOrder) {
    const image = product.images.find((img) => img.public_id === publicId);
    if (image) {
      reorderedImages.push(image);
    }
  }

  // Add any remaining images not in the order array
  product.images.forEach((img) => {
    if (
      !reorderedImages.find(
        (reordered) => reordered.public_id === img.public_id,
      )
    ) {
      reorderedImages.push(img);
    }
  });

  product.images = reorderedImages;
  await product.save();

  res.status(200).json(
    new ApiResponse(200, "Images reordered successfully", {
      productId: product._id,
      images: product.images,
    }),
  );
});

// Set primary image (first image in array will be primary)
exports.setPrimaryImage = asyncHandler(async (req, res) => {
  const product = await Product.findOne({ slug: req.params.slug });

  if (!product) {
    throw new ApiError(404, "Product not found");
  }

  const { publicId } = req.body;

  if (!publicId) {
    throw new ApiError(400, "Please provide image public_id");
  }

  const imageIndex = product.images.findIndex(
    (img) => img.public_id === publicId,
  );

  if (imageIndex === -1) {
    throw new ApiError(404, "Image not found in product");
  }

  // Move the selected image to the front of the array
  const [selectedImage] = product.images.splice(imageIndex, 1);
  product.images.unshift(selectedImage);
  await product.save();

  res.status(200).json(
    new ApiResponse(200, "Primary image set successfully", {
      productId: product._id,
      primaryImage: product.images[0],
    }),
  );
});
