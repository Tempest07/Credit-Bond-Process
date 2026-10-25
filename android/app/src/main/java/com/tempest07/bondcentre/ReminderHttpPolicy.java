package com.tempest07.bondcentre;

final class ReminderHttpPolicy {
    private ReminderHttpPolicy() {}

    static boolean isLoggedOut(int status) {
        return status == 401 || status == 403;
    }

    static boolean acceptsPayload(int status, String contentType) {
        return status == 200 && contentType != null
            && contentType.toLowerCase(java.util.Locale.ROOT).split(";", 2)[0].trim().equals("application/json");
    }
}
