const toggleDarkModeCheckbox = document.getElementById('toggleDarkMode');
const toggleLabel = document.getElementById('toggleLabel');

// Check if dark mode is enabled in localStorage
if (localStorage.getItem('darkMode') === 'enabled') {
    document.body.classList.add('dark-mode');
    toggleDarkModeCheckbox.checked = true;
    toggleLabel.textContent = 'Light Mode'; // Set initial label text
}

// Event listener to toggle dark mode on checkbox change
toggleDarkModeCheckbox.addEventListener('change', () => {
    const body = document.body;
    body.classList.toggle('dark-mode');

    if (body.classList.contains('dark-mode')) {
        toggleLabel.textContent = 'Light Mode'; // Update label to Light Mode
        localStorage.setItem('darkMode', 'enabled');
    } else {
        toggleLabel.textContent = 'Dark Mode'; // Update label to Dark Mode
        localStorage.removeItem('darkMode');
    }
});
