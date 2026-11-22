package androidx.biometric;
public class BiometricManager {
    public static final int BIOMETRIC_SUCCESS = 0;
    public interface Authenticators { int BIOMETRIC_STRONG = 15, BIOMETRIC_WEAK = 255, DEVICE_CREDENTIAL = 32768; }
    public static BiometricManager from(android.content.Context c) { return null; }
    public int canAuthenticate(int authenticators) { return 0; }
}
