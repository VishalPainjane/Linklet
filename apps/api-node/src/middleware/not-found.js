export const notFound = (req, res) => {
    res.status(404).json({
        error: "not_found",
        message: `Cannot ${req.method} ${req.path}`,
    });
};
//# sourceMappingURL=not-found.js.map