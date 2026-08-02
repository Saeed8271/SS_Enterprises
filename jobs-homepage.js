// jobs-homepage.js
// -----------------------------------------------------------------------
// Renders the "Latest Jobs" section on index.html.
// Read-only, public: listens for the newest 8 job postings in Firestore
// and shows them as cards matching the existing Gallery visual style.
// Firestore rules allow public read access to /jobs, so no auth is
// needed on this page.
// -----------------------------------------------------------------------

import { db } from "./firebase-config.js";
import {
  collection,
  query,
  orderBy,
  limit,
  onSnapshot
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

const GRID_ID = "latest-jobs-grid";
const EMPTY_STATE_ID = "latest-jobs-empty";
const MODAL_ID = "jobPosterModal";
const MODAL_IMG_ID = "jobPosterModalImg";

// Live listener: the homepage grid re-renders automatically whenever a job
// is added, replaced, or deleted in the portal — no page refresh needed.
function watchLatestJobs() {
  const grid = document.getElementById(GRID_ID);
  const emptyState = document.getElementById(EMPTY_STATE_ID);
  if (!grid) return;

  const jobsQuery = query(
    collection(db, "jobs"),
    orderBy("createdAt", "desc"),
    limit(8)
  );

  onSnapshot(
    jobsQuery,
    (snapshot) => {
      if (snapshot.empty) {
        grid.innerHTML = "";
        showEmptyState(emptyState, "No job postings yet. Please check back soon.");
        return;
      }

      emptyState.classList.add("d-none");
      grid.innerHTML = "";
      snapshot.forEach((docSnap) => {
        grid.insertAdjacentHTML("beforeend", buildJobCard(docSnap.data()));
      });
    },
    (err) => {
      console.error("Failed to load latest jobs:", err);
      showEmptyState(emptyState, "Job listings are temporarily unavailable. Please check back soon.");
    }
  );
}

function showEmptyState(emptyState, message) {
  if (!emptyState) return;
  emptyState.textContent = message;
  emptyState.classList.remove("d-none");
}

function buildJobCard(job) {
  const formattedDate = formatDate(job.postedDate);
  const thumbUrl = getCloudinaryUrl(job.imageUrl, "f_auto,q_auto,w_800");
  const fullUrl = getCloudinaryUrl(job.imageUrl, "f_auto,q_auto,w_1600");

  return `
    <div class="col-md-6 col-lg-3">
      <div class="card h-100 border-0 shadow-sm overflow-hidden rounded-3">
        <div style="height: 240px; overflow: hidden;">
          <img
            src="${thumbUrl}"
            alt="Job poster posted ${formattedDate}"
            class="w-100 h-100 object-fit-cover transition-transform"
            style="transition: transform 0.3s ease;"
            loading="lazy"
          >
        </div>
        <div class="card-body p-3 bg-white border-top text-center">
          <p class="text-muted small mb-2">
            <i class="fas fa-calendar-alt text-primary me-1"></i> Posted: ${formattedDate}
          </p>
          <button
            type="button"
            class="btn btn-outline-primary btn-sm rounded-pill px-3"
            data-bs-toggle="modal"
            data-bs-target="#${MODAL_ID}"
            data-img="${fullUrl}"
          >
            View Poster
          </button>
        </div>
      </div>
    </div>
  `;
}

// Inserts a Cloudinary transformation string (e.g. "f_auto,q_auto,w_1200")
// right after "/upload/" in a Cloudinary delivery URL. f_auto and q_auto
// let Cloudinary pick the best format/quality per visitor's browser, and
// w_### caps the delivered width so the homepage never downloads a full
// multi-MB original just to show a small card thumbnail.
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

function setupLightbox() {
  const modal = document.getElementById(MODAL_ID);
  if (!modal) return;

  modal.addEventListener("show.bs.modal", (event) => {
    const button = event.relatedTarget;
    const imgUrl = button ? button.getAttribute("data-img") : "";
    const modalImg = document.getElementById(MODAL_IMG_ID);
    if (modalImg) modalImg.src = imgUrl;
  });

  // Clear the image src on close so the browser isn't holding a large
  // image in memory/network once the visitor is done viewing it.
  modal.addEventListener("hidden.bs.modal", () => {
    const modalImg = document.getElementById(MODAL_IMG_ID);
    if (modalImg) modalImg.src = "";
  });
}

document.addEventListener("DOMContentLoaded", () => {
  watchLatestJobs();
  setupLightbox();
});
