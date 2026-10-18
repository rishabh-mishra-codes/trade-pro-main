// Shared lightweight API client. Centralizes base URL, auth header, JSON
// parsing and error handling so every service stays small and consistent.

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:8080/api";

function authHeaders(extra = {}) {
    const token = localStorage.getItem("tradepro_token");
    return {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...extra,
    };
}

export async function api(path, { method = "GET", body, auth = true } = {}) {
    const res = await fetch(`${API_URL}${path}`, {
        method,
        headers: auth ? authHeaders() : { "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
    });

    let data = null;
    try {
        data = await res.json();
    } catch {
        data = null;
    }

    if (!res.ok) {
        throw new Error(data?.message || `Request failed (${res.status})`);
    }
    return data;
}

// Fetches a binary response with the auth header and returns a Blob. Reuses the
// same base URL and "tradepro_token" localStorage key as api(); on a non-ok
// response it surfaces the JSON {message} error, matching api()'s error style.
export async function apiBlob(path) {
    const token = localStorage.getItem("tradepro_token");
    const res = await fetch(`${API_URL}${path}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
    });

    if (!res.ok) {
        let msg = `Request failed (${res.status})`;
        try {
            msg = (await res.json())?.message || msg;
        } catch {
            // non-JSON error body; keep the fallback message
        }
        throw new Error(msg);
    }
    return res.blob();
}

export { API_URL };
