// JavaScript Operations Framework for S S Enterprises
document.addEventListener('DOMContentLoaded', function () {
    const backToTopBtn = document.getElementById('backToTop');

    // Display Back-to-Top Button on page scroll threshold
    window.addEventListener('scroll', function () {
        if (window.scrollY > 400) {
            backToTopBtn.style.display = 'flex';
        } else {
            backToTopBtn.style.display = 'none';
        }
    });

    // Smooth scroll event handler for back to top button
    backToTopBtn.addEventListener('click', function () {
        window.scrollTo({
            top: 0,
            behavior: 'smooth'
        });
    });

    // Collapse navigation overlay panel on click execution inside mobile display viewport
    const navLinks = document.querySelectorAll('.navbar-nav .nav-link');
    const menuToggle = document.getElementById('navbarNav');
    const bsCollapse = new bootstrap.Collapse(menuToggle, { toggle: false });
    
    navLinks.forEach((link) => {
        link.addEventListener('click', () => {
            if (window.getComputedStyle(menuToggle).display !== 'none') {
                bsCollapse.hide();
            }
        });
    });
});
