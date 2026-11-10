import type { ErrorRequestHandler } from "express";
import { DomainError, ValidationError } from "@linklet/shared-types";

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof DomainError) {
    const responseBody: Record<string, unknown> = {
      error: err.code,
      message: err.message,
    };
    if (err instanceof ValidationError && err.details) {
      responseBody["details"] = err.details;
    }
    res.status(err.statusCode).json(responseBody);
    return;
  }

  // Internal unexpected error: log without exposing details or credentials
  console.error(JSON.stringify({
    level: "error",
    message: err?.message ?? "internal_error",
    stack: process.env["NODE_ENV"] === "development" ? err?.stack : undefined,
  }));

  res.status(500).json({
    error: "internal_error",
    message: "An unexpected error occurred",
  });
};

