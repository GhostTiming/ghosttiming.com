const leadForm = document.querySelector("#lead-form");
const formStatus = document.querySelector("#form-status");
const yearNode = document.querySelector("#year");
const submitButton = document.querySelector(".form-btn");
const ZOHO_FLOW_WEBHOOK_URL =
  "https://flow.zoho.com/918478839/flow/webhook/incoming?zapikey=1001.21ad826282e6a5fb18043fb0d6901edc.183af283806dbc5264d3a0e4d0a2e9b0&isdebug=false";

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

if (yearNode) {
  yearNode.textContent = String(new Date().getFullYear());
}

if (leadForm && formStatus) {
  leadForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    const formData = new FormData(leadForm);
    const trapValue = String(formData.get("website") || "").trim();

    if (trapValue) {
      formStatus.textContent = "Submission blocked.";
      formStatus.className = "form-status error";
      return;
    }

    const company = String(formData.get("company") || "").trim();
    const firstName = String(formData.get("firstName") || "").trim();
    const lastName = String(formData.get("lastName") || "").trim();
    const email = String(formData.get("email") || "").trim();
    const phone = String(formData.get("phone") || "").trim();
    const supportType = String(formData.get("supportType") || "").trim();
    const message = String(formData.get("message") || "").trim();

    if (!company || !firstName || !lastName || !email || !supportType || !message) {
      formStatus.textContent = "Please complete all required fields.";
      formStatus.className = "form-status error";
      return;
    }

    const timeline = String(formData.get("timeline") || "").trim();
    const payload = new URLSearchParams({
      company,
      firstName,
      lastName,
      email,
      phone,
      supportType,
      timeline,
      message,
      leadSource: "ghosttiming.com",
      source: "Ghost Timing and Event Support",
      submittedAt: new Date().toISOString(),
    });

    try {
      if (submitButton) {
        submitButton.disabled = true;
        submitButton.textContent = "Sending...";
      }
      formStatus.textContent = "Submitting your request...";
      formStatus.className = "form-status";

      await submitToWebhook(payload);

      formStatus.textContent =
        "Thanks. Your request was sent. We will reach out at the email you provided.";
      formStatus.className = "form-status success";
      leadForm.reset();
    } catch (error) {
      formStatus.textContent =
        "We could not send your request right now. Please email info@ghosttiming.com.";
      formStatus.className = "form-status error";
    } finally {
      if (submitButton) {
        submitButton.disabled = false;
        submitButton.textContent = "Let's Chat";
      }
    }
  });
}
