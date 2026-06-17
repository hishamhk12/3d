// Environment variables required by session-token and other server helpers.
// Set before any test imports run.
process.env.SESSION_TOKEN_SECRET = "test-secret-key-exactly-32-bytes!!";
// Seller session signing secret (>= 32 chars, no weak placeholder).
process.env.SELLER_SESSION_SECRET = "test-seller-session-secret-32-bytes-min!!";
