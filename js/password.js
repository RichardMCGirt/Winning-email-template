  (function () {
    const correctPassword = "Vanir";

    // Check if already authenticated
    if (localStorage.getItem("vanirAuthorized") === "true") return;

    // Immediately hide page
    document.body.style.margin = "0";
    document.body.innerHTML = "";

    // Create full-page black overlay
    const overlay = document.createElement("div");
    overlay.style.position = "fixed";
    overlay.style.inset = "0";
    overlay.style.backgroundColor = "black";
    overlay.style.color = "white";
    overlay.style.display = "flex";
    overlay.style.flexDirection = "column";
    overlay.style.alignItems = "center";
    overlay.style.justifyContent = "center";
    overlay.style.zIndex = "9999";
    overlay.style.fontFamily = "sans-serif";

    const heading = document.createElement("h2");
    heading.textContent = "Please enter the password";

    const input = document.createElement("input");
    input.type = "password";
    input.placeholder = "Enter Password";
    input.style.padding = "12px";
    input.style.fontSize = "18px";
    input.style.borderRadius = "6px";
    input.style.border = "1px solid #ccc";
    input.style.marginTop = "10px";

    const button = document.createElement("button");
    button.textContent = "Submit";
    button.style.marginTop = "10px";
    button.style.padding = "10px 20px";
    button.style.fontSize = "16px";
    button.style.borderRadius = "6px";
    button.style.cursor = "pointer";

    const error = document.createElement("p");
    error.textContent = "Incorrect password";
    error.style.color = "red";
    error.style.marginTop = "10px";
    error.style.display = "none";

    button.onclick = () => {
      if (input.value.trim() === correctPassword) {
        localStorage.setItem("vanirAuthorized", "true");
        overlay.remove(); // allow page to show
        location.reload(); // refresh to show actual page
      } else {
        error.style.display = "block";
      }
    };

    input.addEventListener("keydown", e => {
      if (e.key === "Enter") button.click();
    });

    overlay.appendChild(heading);
    overlay.appendChild(input);
    overlay.appendChild(button);
    overlay.appendChild(error);
    document.body.appendChild(overlay);
  })();
