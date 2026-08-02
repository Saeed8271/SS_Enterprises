// portal.js
// -----------------------------------------------------------------------
// Powers the hidden /portal page: login gate, job list, and the
// upload / replace / delete flows.
//
// Deletion note: deleting or replacing a job removes/updates only the
// Firestore document. The old Cloudinary image is intentionally left
// alone — at this project's scale (a handful of posters a month) that
// costs nothing meaningful on Cloudinary's free tier. Unused images can
// be cleared out manually from the Cloudinary Media Library every so
// often if desired. Secure automatic deletion would require a signed
// request using the Cloudinary API Secret, which can only run safely
// server-side (e.g. a small Cloud Function) — worth adding later if the
// project grows, not needed today.
// -----------------------------------------------------------------------

import { auth, db, CLOUDINARY_UPLOAD_URL, CLOUDINARY_UPLOAD_PRESET, CLOUDINARY_FOLDER } from "./firebase-config.js";
import {
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {
  collection,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  query,
  orderBy,
  getDocs,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5MB, matches Cloudinary preset limit
const ALLOWED_TYPES = ["image/jpeg", "image/jpg", "image/png", "image/webp"];

function validateImageFile(file) {
  if (!file) return "Please select an image.";
  if (!ALLOWED_TYPES.includes(file.type)) return "Only JPG, PNG, or WEBP images are allowed.";
  if (file.size > MAX_FILE_SIZE_BYTES) return "Image is too large. Maximum size is 5MB.";
  return null; // valid
}

// ---------- DOM references ----------
const loginScreen = document.getElementById("login-screen");
const managerScreen = document.getElementById("manager-screen");
const loginForm = document.getElementById("login-form");
const loginError = document.getElementById("login-error");
const loginSubmitBtn = document.getElementById("login-submit-btn");
const logoutBtn = document.getElementById("logout-btn");

const jobsList = document.getElementById("jobs-list");
const emptyState = document.getElementById("jobs-empty-state");
const addJobBtn = document.getElementById("add-job-btn");

const uploadModalEl = document.getElementById("uploadModal");
const uploadForm = document.getElementById("upload-form");
const uploadModalTitle = document.getElementById("uploadModalLabel");
const uploadSubmitBtn = document.getElementById("upload-submit-btn");
const uploadDateInput = document.getElementById("upload-date");
const uploadFileInput = document.getElementById("upload-file");
const uploadJobIdInput = document.getElementById("upload-job-id");
const uploadError = document.getElementById("upload-error");
const uploadPreview = document.getElementById("upload-preview");
const dropzone = document.getElementById("upload-dropzone");

const deleteConfirmModalEl = document.getElementById("deleteConfirmModal");
const confirmDeleteBtn = document.getElementById("confirm-delete-btn");

let uploadModal = null;
let deleteConfirmModal = null;
let pendingDeleteJobId = null;

// ---------- Toast helper ----------
function showToast(message, type = "success") {
  const toastEl = document.getElementById("portalToast");
  const toastBody = document.getElementById("portalToastBody");
  if (!toastEl || !toastBody) return;

  toastBody.textContent = message;
  toastEl.classList.remove("text-bg-success", "text-bg-danger");
  toastEl.classList.add(type === "success" ? "text-bg-success" : "text-bg-danger");

  const toast = bootstrap.Toast.getOrCreateInstance(toastEl, { delay: 3500 });
  toast.show();
}

// ---------- Auth gate ----------
onAuthStateChanged(auth, (user) => {
  if (user) {
    loginScreen.classList.add("d-none");
    managerScreen.classList.remove("d-none");
    loadJobs();
  } else {
    managerScreen.classList.add("d-none");
    loginScreen.classList.remove("d-none");
  }
});

loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  loginError.classList.add("d-none");
  loginSubmitBtn.disabled = true;
  loginSubmitBtn.textContent = "Signing in...";

  const email = document.getElementById("login-email").value.trim();
  const password = document.getElementById("login-password").value;

  try {
    await signInWithEmailAndPassword(auth, email, password);
  } catch (err) {
    loginError.textContent = "Incorrect email or password. Please try again.";
    loginError.classList.remove("d-none");
  } finally {
    loginSubmitBtn.disabled = false;
    loginSubmitBtn.textContent = "Log In";
  }
});

logoutBtn.addEventListener("click", () => signOut(auth));

// ---------- Load & render jobs (newest first, all jobs shown here) ----------
async function loadJobs() {
  jobsList.innerHTML = `<p class="text-muted text-center py-4">Loading jobs...</p>`;
  emptyState.classList.add("d-none");

  const jobsQuery = query(collection(db, "jobs"), orderBy("createdAt", "desc"));
  const snapshot = await getDocs(jobsQuery);

  if (snapshot.empty) {
    jobsList.innerHTML = "";
    emptyState.classList.remove("d-none");
    return;
  }

  jobsList.innerHTML = "";
  snapshot.forEach((docSnap) => {
    jobsList.insertAdjacentHTML("beforeend", buildJobRow(docSnap.id, docSnap.data()));
  });
}

function buildJobRow(id, job) {
  const formattedDate = formatDate(job.postedDate);
  const thumbUrl = getCloudinaryUrl(job.imageUrl, "f_auto,q_auto,w_200");
  return `
    <div class="job-row d-flex align-items-center gap-3 p-3 bg-white rounded-3 shadow-sm mb-3" data-job-id="${id}">
      <img src="${thumbUrl}" alt="Job poster" class="job-thumb rounded-3">
      <div class="flex-grow-1">
        <p class="mb-0 fw-semibold text-dark">Posted: ${formattedDate}</p>
        ${job.uploadedBy ? `<p class="mb-0 small text-muted">Uploaded by ${job.uploadedBy}</p>` : ""}
      </div>
      <div class="d-flex gap-2 flex-shrink-0">
        <button class="btn btn-outline-primary btn-sm rounded-pill replace-btn" data-id="${id}" data-date="${job.postedDate || ""}">
          <i class="fas fa-rotate"></i> Replace
        </button>
        <button class="btn btn-outline-danger btn-sm rounded-pill delete-btn" data-id="${id}">
          <i class="fas fa-trash"></i> Delete
        </button>
      </div>
    </div>
  `;
}

function getCloudinaryUrl(url, transformation) {
  if (!url || !url.includes("/upload/")) return url || "";
  return url.replace("/upload/", `/upload/${transformation}/`);
}

function formatDate(dateStr) {
  if (!dateStr) return "N/A";
  const parsed = new Date(dateStr);
  if (isNaN(parsed)) return dateStr;
  return parsed.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

// ---------- Open upload modal: "Add" mode ----------
addJobBtn.addEventListener("click", () => {
  openUploadModal({ mode: "add" });
});

// ---------- Open upload modal: "Replace" mode / trigger delete (event delegation) ----------
jobsList.addEventListener("click", (e) => {
  const replaceBtn = e.target.closest(".replace-btn");
  const deleteBtn = e.target.closest(".delete-btn");

  if (replaceBtn) {
    openUploadModal({
      mode: "replace",
      jobId: replaceBtn.dataset.id,
      existingDate: replaceBtn.dataset.date
    });
  }

  if (deleteBtn) {
    pendingDeleteJobId = deleteBtn.dataset.id;
    if (!deleteConfirmModal) {
      deleteConfirmModal = new bootstrap.Modal(deleteConfirmModalEl);
    }
    deleteConfirmModal.show();
  }
});

function openUploadModal({ mode, jobId = "", existingDate = "" }) {
  uploadForm.reset();
  uploadError.classList.add("d-none");
  if (uploadPreview) {
    uploadPreview.src = "";
    uploadPreview.classList.remove("show");
  }
  uploadJobIdInput.value = jobId;
  uploadModalTitle.textContent = mode === "replace" ? "Replace Job Poster" : "Upload New Job";
  uploadDateInput.value = existingDate || new Date().toISOString().split("T")[0];
  uploadFileInput.required = true;
  resetUploadButton(mode);

  if (!uploadModal) {
    uploadModal = new bootstrap.Modal(uploadModalEl);
  }
  uploadModal.show();
}

function resetUploadButton(mode) {
  uploadSubmitBtn.disabled = false;
  uploadSubmitBtn.textContent = mode === "replace" ? "Replace Job" : "Save Job";
}

// ---------- Live preview + validation on file selection ----------
uploadFileInput.addEventListener("change", () => {
  const file = uploadFileInput.files[0];
  if (!uploadPreview || !file) return;

  const validationMessage = validateImageFile(file);
  if (validationMessage) {
    showUploadError(validationMessage);
    uploadFileInput.value = "";
    uploadPreview.src = "";
    uploadPreview.classList.remove("show");
    return;
  }
  uploadError.classList.add("d-none");

  const reader = new FileReader();
  reader.onload = (e) => {
    uploadPreview.src = e.target.result;
    uploadPreview.classList.add("show");
  };
  reader.readAsDataURL(file);
});

// ---------- Drag-and-drop upload ----------
if (dropzone) {
  dropzone.addEventListener("click", () => uploadFileInput.click());
  dropzone.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      uploadFileInput.click();
    }
  });

  ["dragenter", "dragover"].forEach((eventName) => {
    dropzone.addEventListener(eventName, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropzone.classList.add("dragover");
    });
  });

  ["dragleave", "drop"].forEach((eventName) => {
    dropzone.addEventListener(eventName, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropzone.classList.remove("dragover");
    });
  });

  dropzone.addEventListener("drop", (e) => {
    const files = e.dataTransfer.files;
    if (files && files.length) {
      uploadFileInput.files = files;
      uploadFileInput.dispatchEvent(new Event("change"));
    }
  });
}

// ---------- Upload / Replace submit ----------
uploadForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  uploadError.classList.add("d-none");

  const jobId = uploadJobIdInput.value;
  const isReplace = Boolean(jobId);
  const file = uploadFileInput.files[0];
  const postedDate = uploadDateInput.value;

  const validationMessage = validateImageFile(file);
  if (validationMessage) {
    showUploadError(validationMessage);
    return;
  }

  uploadSubmitBtn.disabled = true;
  uploadSubmitBtn.innerHTML = `<span class="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>${isReplace ? "Replacing..." : "Uploading..."}`;

  try {
    const { imageUrl, publicId } = await uploadToCloudinary(file);
    const staffEmail = auth.currentUser ? auth.currentUser.email : "";

    if (isReplace) {
      await updateDoc(doc(db, "jobs", jobId), {
        imageUrl,
        publicId,
        postedDate,
        uploadedBy: staffEmail
      });
      showToast("✅ Job replaced successfully.");
    } else {
      await addDoc(collection(db, "jobs"), {
        imageUrl,
        publicId,
        postedDate,
        uploadedBy: staffEmail,
        createdAt: serverTimestamp()
      });
      showToast("✅ Job uploaded successfully.");
    }

    uploadModal.hide();
    loadJobs();
  } catch (err) {
    console.error("Upload failed:", err);
    showUploadError("Upload failed. Please check your connection and try again.");
    showToast("❌ Upload failed. Please try again.", "error");
  } finally {
    resetUploadButton(isReplace ? "replace" : "add");
  }
});

function showUploadError(message) {
  uploadError.textContent = message;
  uploadError.classList.remove("d-none");
}

async function uploadToCloudinary(file) {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("upload_preset", CLOUDINARY_UPLOAD_PRESET);
  formData.append("folder", CLOUDINARY_FOLDER);

  const res = await fetch(CLOUDINARY_UPLOAD_URL, { method: "POST", body: formData });
  if (!res.ok) throw new Error("Cloudinary upload failed");

  const data = await res.json();
  return { imageUrl: data.secure_url, publicId: data.public_id };
}

// ---------- Delete (confirmed via modal) ----------
confirmDeleteBtn.addEventListener("click", async () => {
  if (!pendingDeleteJobId) return;

  const jobId = pendingDeleteJobId;
  confirmDeleteBtn.disabled = true;
  confirmDeleteBtn.innerHTML = `<span class="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>Deleting...`;

  try {
    await deleteDoc(doc(db, "jobs", jobId));
    showToast("✅ Job deleted successfully.");
    deleteConfirmModal.hide();
    loadJobs();
  } catch (err) {
    console.error("Delete failed:", err);
    showToast("❌ Delete failed. Please try again.", "error");
  } finally {
    confirmDeleteBtn.disabled = false;
    confirmDeleteBtn.textContent = "Delete";
    pendingDeleteJobId = null;
  }
});
