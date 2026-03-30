const express = require("express");
const dotenv = require("dotenv");
const connectDb = require("./db/connect");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const errorHandler = require("./middlewares/error.middleware");
const app = express();

dotenv.config();

app.use(
  cors({
    origin: process.env.CORS_ORIGIN,
    credentials: true,
  }),
);

app.use(express.json({ limit: "16kb" }));
app.use(express.urlencoded({ extended: true, limit: "16kb" }));

app.use(cookieParser());

connectDb();

app.use("/api/users", require("./routes/auth.routes"));
app.use("/api/products", require("./routes/product.routes"));
app.use("/api/category", require("./routes/category.routes"));
app.use("/api/dashboard", require("./routes/dashboard.routes"));
app.use("/api/audit-logs", require("./routes/auditLog.routes"));

app.use(errorHandler);

app.listen(process.env.PORT, () => {
  console.log(`server is listen on port http://localhost/${process.env.PORT}`);
});
