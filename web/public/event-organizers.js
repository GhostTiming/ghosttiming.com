const organizerForm = document.querySelector("#organizer-form");
const organizerStatus = document.querySelector("#organizer-form-status");
const organizerSubmitButton = document.querySelector(".form-btn");
const ZOHO_FLOW_WEBHOOK_URL =
  "https://flow.zoho.com/918478839/flow/webhook/incoming?zapikey=1001.21ad826282e6a5fb18043fb0d6901edc.183af283806dbc5264d3a0e4d0a2e9b0&isdebug=false";
const STRING_REGEX = /^[A-Za-z0-9 .,'&()\-\/#]+$/;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_REGEX = /^[+]?[\d\s().-]{7,20}$/;

async function submitToWebhook(payload) {
  await fetch(ZOHO_FLOW_WEBHOOK_URL, {
    method: "POST",
    mode: "no-cors",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
    },
    body: payload.toString(),
  });
}

if (organizerForm && organizerStatus) {
  organizerForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    const formData = new FormData(organizerForm);
    const eventName = String(formData.get("eventName") || "").trim();
    const firstName = String(formData.get("firstName") || "").trim();
    const lastName = String(formData.get("lastName") || "").trim();
    const email = String(formData.get("email") || "").trim();
    const phone = String(formData.get("phone") || "").trim();
    const orgName = String(formData.get("orgName") || "").trim();
    const raceWebsite = String(formData.get("raceWebsite") || "").trim();
    const anticipatedParticipants = String(formData.get("anticipatedParticipants") || "").trim();
    const eventDescription = String(formData.get("eventDescription") || "").trim();

    if (!eventName || !firstName || !lastName || !email || !orgName || !anticipatedParticipants || !eventDescription) {
      organizerStatus.textContent = "Please complete all required fields.";
      organizerStatus.className = "form-status error";
      return;
    }

    if (
      !STRING_REGEX.test(eventName) ||
      !STRING_REGEX.test(firstName) ||
      !STRING_REGEX.test(lastName) ||
      !STRING_REGEX.test(orgName)
    ) {
      organizerStatus.textContent = "Event, name, and company fields must be valid text values.";
      organizerStatus.className = "form-status error";
      return;
    }

    if (!EMAIL_REGEX.test(email)) {
      organizerStatus.textContent = "Please provide a valid email address.";
      organizerStatus.className = "form-status error";
      return;
    }

    if (phone && !PHONE_REGEX.test(phone)) {
      organizerStatus.textContent = "Please provide a valid phone number format.";
      organizerStatus.className = "form-status error";
      return;
    }

    if (!/^\d+$/.test(anticipatedParticipants)) {
      organizerStatus.textContent = "Anticipated number of participants must be numbers only.";
      organizerStatus.className = "form-status error";
      return;
    }

    if (!STRING_REGEX.test(eventDescription)) {
      organizerStatus.textContent = "Description of event must be a text value.";
      organizerStatus.className = "form-status error";
      return;
    }

    if (raceWebsite && !raceWebsite.includes(".")) {
      organizerStatus.textContent = "Race website link must include a dot (example: example.com).";
      organizerStatus.className = "form-status error";
      return;
    }

    const payload = new URLSearchParams({
      eventName,
      firstName,
      lastName,
      email,
      phone,
      orgName,
      raceWebsite,
      anticipatedParticipants,
      eventDescription,
      destinationEmail: "michelle@run4acause.org",
      leadSource: "ghosttiming.com",
      source: "Run4aCause",
      submittedAt: new Date().toISOString(),
    });

    try {
      if (organizerSubmitButton) {
        organizerSubmitButton.disabled = true;
        organizerSubmitButton.textContent = "Sending...";
      }
      organizerStatus.textContent = "Submitting your request...";
      organizerStatus.className = "form-status";

      await submitToWebhook(payload);

      organizerStatus.textContent = "Thanks. Your request was sent to Run4aCause.";
      organizerStatus.className = "form-status success";
      organizerForm.reset();
    } catch (error) {
      organizerStatus.textContent = "We could not send your request right now. Please try again.";
      organizerStatus.className = "form-status error";
    } finally {
      if (organizerSubmitButton) {
        organizerSubmitButton.disabled = false;
        organizerSubmitButton.textContent = "Send Request";
      }
    }
  });
}
