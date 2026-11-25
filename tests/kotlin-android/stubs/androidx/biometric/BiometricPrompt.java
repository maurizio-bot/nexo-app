package androidx.biometric;
public class BiometricPrompt {
    public BiometricPrompt(androidx.fragment.app.FragmentActivity a, java.util.concurrent.Executor e, AuthenticationCallback cb) {}
    public void authenticate(PromptInfo info) {}
    public void cancelAuthentication() {}
    public static class AuthenticationResult {}
    public static abstract class AuthenticationCallback {
        public void onAuthenticationError(int code, CharSequence err) {}
        public void onAuthenticationSucceeded(AuthenticationResult r) {}
        public void onAuthenticationFailed() {}
    }
    public static class PromptInfo {
        public static class Builder {
            public Builder setTitle(CharSequence c) { return this; }
            public Builder setSubtitle(CharSequence c) { return this; }
            public Builder setDescription(CharSequence c) { return this; }
            public Builder setNegativeButtonText(CharSequence c) { return this; }
            public Builder setAllowedAuthenticators(int a) { return this; }
            public Builder setConfirmationRequired(boolean b) { return this; }
            public PromptInfo build() { return null; }
        }
    }
}
