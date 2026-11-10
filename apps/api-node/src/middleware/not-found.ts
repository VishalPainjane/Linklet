import type { RequestHandler } from "express";

export const notFound: RequestHandler = (req, res) => {
  res.status(404).json({
    error: "not_found",
    message: `Cannot ${req.method} ${req.path}`,
  });
};

