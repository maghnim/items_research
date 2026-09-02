// Express 4 does not catch rejected promises from async route handlers — an unhandled
// rejection (a failed db.query, a bad UUID, a downstream API error) crashes the entire
// process. Wrapping every async handler with this forwards the error to server.js's
// error middleware instead.
function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

module.exports = { asyncHandler };
