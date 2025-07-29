 // Checkbox dependency logic for blank subcontractor email
    const blankSubEmailCheckbox = document.getElementById("optionSendBlankSubEmail");
    const blankSubEmailMessage = document.getElementById("blankSubEmailMessage");
    const subCheckbox = document.getElementById("optionSubcontractor");

    if (blankSubEmailCheckbox && blankSubEmailMessage && subCheckbox) {
      blankSubEmailCheckbox.addEventListener("change", function () {
        if (this.checked) {
          blankSubEmailMessage.style.display = "block";
          console.log("☑️ 'Send empty Subcontractor Email' checkbox checked — message shown.");

          if (subCheckbox.checked) {
            subCheckbox.checked = false;
            console.log("🔁 'Send Subcontractor Email' was unchecked due to empty subcontractor email setting.");
          }
        } else {
          blankSubEmailMessage.style.display = "none";
          console.log("⬜ 'Send empty Subcontractor Email' checkbox unchecked — message hidden.");
        }
      });

      subCheckbox.addEventListener("change", function () {
        if (!this.checked) {
          blankSubEmailCheckbox.checked = true;
          blankSubEmailMessage.style.display = "block";
          console.log("🔄 'Send Subcontractor Email' unchecked — 'Send empty Subcontractor Email' auto-checked.");
        }
      });

    } else {
      console.warn("⚠️ Required checkbox or message container not found.");
    }