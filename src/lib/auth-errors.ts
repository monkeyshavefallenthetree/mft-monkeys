export function mapAuthError(code: string | undefined, fallback: string): string {
  switch (code) {
    case "auth/user-not-found":
      return "No account found with this email. Please register first.";
    case "auth/wrong-password":
    case "auth/invalid-credential":
      return "Incorrect email or password. Please try again.";
    case "auth/invalid-email":
      return "Please enter a valid email address.";
    case "auth/user-disabled":
      return "This account has been disabled. Please contact support.";
    case "auth/too-many-requests":
      return "Too many failed attempts. Please try again later.";
    case "auth/email-already-in-use":
      return "This email is already registered. Use a different email or sign in.";
    case "auth/weak-password":
      return "Password is too weak. Choose a stronger password.";
    case "auth/operation-not-allowed":
      return "Email/password sign-in is not enabled. Contact support.";
    default:
      return fallback;
  }
}
