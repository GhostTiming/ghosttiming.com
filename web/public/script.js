const leadForm = document.querySelector("#lead-form");
const formStatus = document.querySelector("#form-status");
const yearNode = document.querySelector("#year");
const submitButton = document.querySelector(".form-btn");
const formStartedAtInput = document.querySelector("#form-started-at");

const CONTACT_API_ENDPOINT = "/api/contact";

function setStatus(message, isError = false, isSuccess = false) {
  if (!formStatus) return;
  formStatus.textContent = message;
  formStatus.className = "form-status";
  if (isError) {
    formStatus.classList.add("error");
  } else if (isSuccess) {
    formStatus.classList.add("success");
  }
}

if (yearNode) {
  yearNode.textContent = String(new Date().getFullYear());
}

if (leadForm && formStatus) {
  if (formStartedAtInput) {
    formStartedAtInput.value = String(Date.now());
  }

  leadForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    const formData = new FormData(leadForm);
    const trapValue = String(formData.get("website") || "").trim();

    if (trapValue) {
      setStatus("Submission blocked.", true);
      return;
    }

    const name = String(formData.get("name") || "").trim();
    const email = String(formData.get("email") || "").trim();
    const phone = String(formData.get("phone") || "").trim();
    const eventDate = String(formData.get("eventDate") || "").trim();
    const eventLocation = String(formData.get("eventLocation") || "").trim();
    const message = String(formData.get("message") || "").trim();
    const formStartedAt = String(formData.get("formStartedAt") || "").trim();

    if (!name || !email || !message) {
      setStatus("Please complete all required fields.", true);
      return;
    }

    try {
      if (submitButton) {
        submitButton.disabled = true;
        submitButton.textContent = "Sending...";
      }
      setStatus("Submitting your request...");

      const response = await fetch(CONTACT_API_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name,
          email,
          phone,
          eventDate,
          eventLocation,
          message,
          website: trapValue,
          formStartedAt,
        }),
      });

      const result = await response.json().catch(() => null);
      if (!response.ok) {
        const messageFromServer =
          result && typeof result.error === "string"
            ? result.error
            : "Please review your form details and try again.";
        setStatus(messageFromServer, true);
        return;
      }

      setStatus(
        "Thanks. Your request was sent. We will reach out at the email you provided.",
        false,
        true,
      );
      leadForm.reset();
      if (formStartedAtInput) {
        formStartedAtInput.value = String(Date.now());
      }
    } catch (error) {
      setStatus(
        "We could not send your request right now. Please email info@ghosttiming.com.",
        true,
      );
    } finally {
      if (submitButton) {
        submitButton.disabled = false;
        submitButton.textContent = "Let's Chat";
      }
    }
  });
}
