package androidx.core.app;
public class Person {
    public static class Builder {
        public Builder setName(CharSequence n) { return this; }
        public Builder setKey(String k) { return this; }
        public Builder setImportant(boolean b) { return this; }
        public Builder setBot(boolean b) { return this; }
        public Builder setIcon(androidx.core.graphics.drawable.IconCompat i) { return this; }
        public Person build() { return null; }
    }
}
