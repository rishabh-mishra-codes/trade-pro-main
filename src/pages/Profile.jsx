import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { FaUserCircle, FaCamera, FaArrowLeft, FaTrash, FaPen } from "react-icons/fa";
import authService from "../services/authService";
import NavBar from "../components/NavBar";
import TextInput from "../components/TextInput";
import {
    getAvatar,
    saveAvatar,
    removeAvatar,
    fileToAvatarDataUrl,
    updateProfile,
} from "../services/profileService";
const EDITABLE_FIELDS = [
    { key: "fullName", label: "Full Name", type: "text" },
    { key: "phoneNumber", label: "Phone", type: "tel" },
    { key: "address", label: "Address", type: "text" },
    { key: "dateOfBirth", label: "Date of Birth", type: "date" },
];
function blankForm(user) {
    return {
        fullName: user?.fullName || user?.name || "",
        phoneNumber: user?.phoneNumber || "",
        address: user?.address || "",
        dateOfBirth: user?.dateOfBirth || "",
    };
}
// Client-side profile validation mirroring the backend rules exactly.
// Returns a map of { fieldKey: errorMessage } containing only failing fields.
function validateProfile(form) {
    const e = {};
    if (form.phoneNumber && !/^\d{10}$/.test(form.phoneNumber))
        e.phoneNumber = "Phone number must be exactly 10 digits";
    if (form.dateOfBirth) {
        const d = new Date(form.dateOfBirth);
        const today = new Date();
        if (Number.isNaN(d.getTime())) {
            e.dateOfBirth = "Date of birth is not a valid date";
        } else if (d > today) {
            e.dateOfBirth = "Date of birth cannot be in the future";
        } else {
            let age = today.getFullYear() - d.getFullYear();
            const m = today.getMonth() - d.getMonth();
            if (m < 0 || (m === 0 && today.getDate() < d.getDate())) age--;
            if (d < new Date("1900-01-01") || age < 18)
                e.dateOfBirth =
                    "You must be at least 18 years old (and born on/after 1 Jan 1900)";
        }
    }
    if (form.address) {
        const t = form.address.trim();
        if (!t || t.length > 200 || /[\u0000-\u001F\u007F]/.test(t))
            e.address =
                "Address must be non-empty, ≤200 chars, and free of control characters";
    }
    return e;
}
function Profile() {
    const navigate = useNavigate();
    const fileRef = useRef(null);
    const [user, setUser] = useState(null);
    const [avatar, setAvatar] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [editing, setEditing] = useState(false);
    const [form, setForm] = useState(blankForm(null));
    const [fieldErrors, setFieldErrors] = useState({});
    const [saving, setSaving] = useState(false);
    const [success, setSuccess] = useState("");
    useEffect(() => {
        const load = async () => {
            try {
                const current = await authService.getCurrentUser();
                setUser(current);
                setAvatar(getAvatar(current.$id));
            } catch {
                navigate("/");
            } finally {
                setLoading(false);
            }
        };
        load();
    }, [navigate]);
    const handleFile = async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        setError("");
        try {
            const dataUrl = await fileToAvatarDataUrl(file);
            saveAvatar(user.$id, dataUrl);
            setAvatar(dataUrl);
        } catch (err) {
            setError(err.message);
        }
    };
    const handleRemove = () => {
        removeAvatar(user.$id);
        setAvatar(null);
    };
    const startEdit = () => {
        setForm(blankForm(user));
        setError("");
        setSuccess("");
        setFieldErrors({});
        setEditing(true);
    };
    const cancelEdit = () => {
        setEditing(false);
        setForm(blankForm(user));
        setError("");
        setFieldErrors({});
    };
    // Clear a single field's error as the user edits it.
    const clearFieldError = (key) => {
        setFieldErrors((prev) => {
            if (!prev[key]) return prev;
            const next = { ...prev };
            delete next[key];
            return next;
        });
    };
    const handleField = (key) => (e) => {
        const { value } = e.target;
        setForm((prev) => ({ ...prev, [key]: value }));
        clearFieldError(key);
    };
    // Phone field is hardened so letters can't be typed: strip non-digits and
    // cap at 10 characters before updating form state. Still clears its error.
    const handlePhoneField = (e) => {
        const cleaned = e.target.value.replace(/\D/g, "").slice(0, 10);
        setForm((prev) => ({ ...prev, phoneNumber: cleaned }));
        clearFieldError("phoneNumber");
    };
    const handleSave = async () => {
        if (!form.fullName.trim()) {
            setError("Full name is required");
            return;
        }
        // Validate all fields against the backend rules. Block the request when
        // any error is present (R4.9); only send when every field passes (R4.10).
        const errors = validateProfile(form);
        if (Object.keys(errors).length > 0) {
            setFieldErrors(errors);
            return;
        }
        setFieldErrors({});
        setSaving(true);
        setError("");
        setSuccess("");
        try {
            const updated = await updateProfile({
                fullName: form.fullName.trim(),
                phoneNumber: form.phoneNumber,
                address: form.address,
                dateOfBirth: form.dateOfBirth,
            });
            setUser((prev) => ({ ...prev, ...updated }));
            setEditing(false);
            setSuccess("Profile updated");
        } catch (err) {
            setError(err.message || "Could not update profile");
        } finally {
            setSaving(false);
        }
    };
    const logout = async () => {
        await authService.logout();
        navigate("/");
    };
    if (loading) {
        return (
            <div className="min-h-screen app-bg flex items-center justify-center">
                <div className="w-12 h-12 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin" />
            </div>
        );
    }
    const readOnlyFields = [
        { label: "Full Name", value: user?.fullName || user?.name },
        { label: "Email", value: user?.email },
        { label: "Phone", value: user?.phoneNumber || "—" },
        { label: "Address", value: user?.address || "—" },
        { label: "Date of Birth", value: user?.dateOfBirth || "—" },
        { label: "Membership", value: user?.membershipStatus || "active" },
    ];
    return (
        <div className="min-h-screen app-bg">
            <NavBar user={{ ...user, avatarUrl: avatar }} onLogout={logout} live />
            <main className="max-w-4xl mx-auto px-6 py-8">
                <button
                    onClick={() => navigate("/home")}
                    className="flex items-center gap-2 text-muted hover:text-current mb-6"
                >
                    <FaArrowLeft /> Back to dashboard
                </button>
                <div className="surface rounded-3xl overflow-hidden">
                    <div className="h-32 bg-gradient-to-r from-indigo-600 via-purple-600 to-fuchsia-600" />
                    <div className="px-8 pb-8">
                        <div className="-mt-16 flex items-end gap-5">
                            <div className="relative">
                                {avatar ? (
                                    <img
                                        src={avatar}
                                        alt="avatar"
                                        className="w-32 h-32 rounded-2xl object-cover border-4 border-[var(--bg)] shadow-xl"
                                    />
                                ) : (
                                    <div className="w-32 h-32 rounded-2xl bg-slate-700 border-4 border-[var(--bg)] flex items-center justify-center shadow-xl">
                                        <FaUserCircle className="text-6xl text-slate-400" />
                                    </div>
                                )}
                                <button
                                    onClick={() => fileRef.current?.click()}
                                    className="absolute -bottom-2 -right-2 h-10 w-10 rounded-full bg-indigo-600 hover:bg-indigo-700 text-white flex items-center justify-center shadow-lg"
                                    title="Upload photo"
                                >
                                    <FaCamera size={14} />
                                </button>
                                <input
                                    ref={fileRef}
                                    type="file"
                                    accept="image/*"
                                    onChange={handleFile}
                                    className="hidden"
                                />
                            </div>
                            <div className="pb-2">
                                <h2 className="text-2xl font-bold">
                                    {user?.fullName || user?.name}
                                </h2>
                                <p className="text-muted text-sm">{user?.email}</p>
                            </div>
                            {avatar && (
                                <button
                                    onClick={handleRemove}
                                    className="ml-auto pb-2 text-sm text-red-400 hover:text-red-300 flex items-center gap-1.5"
                                >
                                    <FaTrash size={12} /> Remove photo
                                </button>
                            )}
                        </div>
                        {error && (
                            <p className="mt-4 text-sm text-red-400">{error}</p>
                        )}
                        {success && (
                            <p className="mt-4 text-sm text-emerald-400">{success}</p>
                        )}
                        <div className="mt-8 flex items-center justify-between">
                            <h3 className="text-lg font-bold">Profile details</h3>
                            {!editing && (
                                <button
                                    onClick={startEdit}
                                    className="flex items-center gap-2 text-sm text-indigo-400 hover:text-indigo-300"
                                >
                                    <FaPen size={12} /> Edit profile
                                </button>
                            )}
                        </div>
                        {editing ? (
                            <div className="mt-5">
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                                    {EDITABLE_FIELDS.map((f) => (
                                        <label key={f.key} className="block">
                                            <span className="text-xs text-muted">
                                                {f.label}
                                            </span>
                                            <div className="mt-1.5">
                                                {f.key === "phoneNumber" ? (
                                                    <TextInput
                                                        type={f.type}
                                                        inputMode="numeric"
                                                        maxLength={10}
                                                        value={form[f.key]}
                                                        onChange={handlePhoneField}
                                                    />
                                                ) : (
                                                    <TextInput
                                                        type={f.type}
                                                        value={form[f.key]}
                                                        onChange={handleField(f.key)}
                                                    />
                                                )}
                                            </div>
                                            {fieldErrors[f.key] && (
                                                <span className="mt-1 block text-xs text-red-400">
                                                    {fieldErrors[f.key]}
                                                </span>
                                            )}
                                        </label>
                                    ))}
                                    <div className="block">
                                        <span className="text-xs text-muted">Email</span>
                                        <p className="mt-1.5 rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-muted break-words">
                                            {user?.email}
                                        </p>
                                    </div>
                                </div>
                                <div className="mt-6 flex gap-3">
                                    <button
                                        onClick={handleSave}
                                        disabled={saving}
                                        className="px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white text-sm font-semibold"
                                    >
                                        {saving ? "Saving..." : "Save"}
                                    </button>
                                    <button
                                        onClick={cancelEdit}
                                        disabled={saving}
                                        className="px-5 py-2.5 rounded-xl border border-white/10 hover:bg-white/5 text-sm"
                                    >
                                        Cancel
                                    </button>
                                </div>
                            </div>
                        ) : (
                            <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 gap-5">
                                {readOnlyFields.map((f) => (
                                    <div
                                        key={f.label}
                                        className="rounded-xl border border-white/10 bg-white/5 p-4"
                                    >
                                        <p className="text-xs text-muted">{f.label}</p>
                                        <p className="font-semibold mt-1 capitalize break-words">
                                            {f.value}
                                        </p>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            </main>
        </div>
    );
}
export default Profile;
