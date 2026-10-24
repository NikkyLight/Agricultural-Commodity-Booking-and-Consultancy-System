// Shared password rule used by registration and the admin seed script.
// Returns an error message, or null when the password is acceptable.
function passwordProblem(password) {
  if (password.length < 8) {
    return "Password must be at least 8 characters.";
  }

  // bcrypt silently ignores anything past 72 bytes.
  if (Buffer.byteLength(password, "utf8") > 72) {
    return "Password must be at most 72 bytes.";
  }

  if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
    return "Password must include at least one letter and one number.";
  }

  return null;
}

module.exports = { passwordProblem };
