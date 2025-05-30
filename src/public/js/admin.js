let expandedRows = new Set();
let currentUserId = null;
let currentDisplayId = null;
let currentRowIndex = null;
let ws;

function connectWebSocket() {
  const wsUrl = `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${
    window.location.host
  }/ws`;
  console.log("Connecting to WebSocket:", wsUrl);

  ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    console.log("WebSocket connected");
    // Send ping every 30 seconds to keep connection alive
    setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "ping" }));
      }
    }, 30000);
  };

  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      handleWebSocketMessage(data);
    } catch (error) {
      console.error("WebSocket message error:", error);
    }
  };

  ws.onclose = () => {
    console.log("WebSocket disconnected");
    // Attempt to reconnect after 5 seconds
    setTimeout(connectWebSocket, 5000);
  };

  ws.onerror = (error) => {
    console.error("WebSocket error:", error);
  };
}

// Add message handler
function handleWebSocketMessage(data) {
  switch (data.type) {
    case "connection":
      console.log("Connection status:", data.status);
      break;
    case "leaderboard_update":
      fetchLeaderboard(); // Refresh leaderboard data
      break;
    default:
      console.log("Received message:", data);
  }
}

// Display leaderboard
function displayLeaderboard(data) {
  const tbody = document.getElementById("leaderboardTable");
  tbody.innerHTML = "";

  data.forEach((user, index) => {
    const row = document.createElement("tr");
    row.setAttribute("data-index", index);
    row.style.cursor = "pointer";
    row.addEventListener("click", () => {
      toggleExpandRow(
        index,
        user.source === "user" ? user.id : null,
        user.display_id
      );
    });

    // Rank cell with special styling for top 3 and source
    const rankClass = index < 3 ? `rank-${index + 1}` : "";
    const sourceClass = `source-${user.source}`;

    // Add points and exp displays
    const pointsDisplay =
      user.source === "user"
        ? `<div class="points-display"><i class="fa-solid fa-coins"></i> ${user.points.toLocaleString()}</div>`
        : "";

    const expDisplay = `<div class="exp-display"><i class="fa-solid fa-star"></i> ${user.exp.toLocaleString()}</div>`;

    row.innerHTML = `
      <td class="rank ${rankClass} ${sourceClass}" data-number="${index + 1}">${
      index + 1
    }</td>
      <td>
        ${user.name} <small>#${user.display_id}</small>
        ${
          user.source === "temporary" && user.class
            ? `<br><small class="text-muted">${user.class}</small>`
            : pointsDisplay
        }
      </td>
      <td>${expDisplay}</td>
      <td>
        <span class="source-badge source-${user.source}">
          ${user.source === "user" ? "Registered" : "Temporary"}
        </span>
      </td>
    `;

    tbody.appendChild(row);
  });
}

function toggleExpandRow(index, userId, displayId) {
  const row = document.querySelector(`tr[data-index="${index}"]`);
  const existingExpanded = document.querySelector(
    `tr[data-expanded="${index}"]`
  );

  // Remove any other expanded rows first
  expandedRows.forEach((expandedIndex) => {
    if (expandedIndex !== index) {
      const otherExpanded = document.querySelector(
        `tr[data-expanded="${expandedIndex}"]`
      );
      const otherRow = document.querySelector(
        `tr[data-index="${expandedIndex}"]`
      );
      otherExpanded?.remove();
      otherRow?.classList.remove("expanded-row");
      expandedRows.delete(expandedIndex);
    }
  });

  if (expandedRows.has(index)) {
    // Collapse
    existingExpanded?.remove();
    row?.classList.remove("expanded-row");
    expandedRows.delete(index);
  } else {
    // Expand
    expandedRows.add(index);
    row?.classList.add("expanded-row");

    const newRow = document.createElement("tr");
    newRow.setAttribute("data-expanded", index);

    // Only show points controls for registered users
    const pointsControls = userId
      ? `
      <div class="exp-control mt-2">
        <button onclick="showAddPointsModal('${userId}', ${index})" class="btn btn-warning">
          <i class="fa-solid fa-coins"></i> Add Points
        </button>
        <button onclick="showReducePointsModal('${userId}', ${index})" class="btn btn-danger">
          <i class="fa-solid fa-coins"></i> Reduce Points
        </button>
      </div>
    `
      : "";

    newRow.innerHTML = `
      <td colspan="4" class="expanded-content">
        <div class="expanded-details">
          <div class="exp-control">
            <button onclick="showAddExpModal('${
              userId || ""
            }', '${displayId}', ${index})" class="btn btn-success">
              <i class="fa-solid fa-plus"></i> Add EXP
            </button>
            <button onclick="showReduceExpModal('${
              userId || ""
            }', '${displayId}', ${index})" class="btn btn-danger">
              <i class="fa-solid fa-minus"></i> Reduce EXP
            </button>
          </div>
          ${pointsControls}
        </div>
      </td>
    `;

    row.parentNode.insertBefore(newRow, row.nextSibling);
  }
}

function showAddExpModal(userId, displayId, index) {
  currentUserId = userId;
  currentDisplayId = displayId;
  currentRowIndex = index;
  const modal = new bootstrap.Modal(document.getElementById("addExpModal"));
  modal.show();
}

function showReduceExpModal(userId, displayId, index) {
  currentUserId = userId;
  currentDisplayId = displayId;
  currentRowIndex = index;
  const modal = new bootstrap.Modal(document.getElementById("reduceExpModal"));
  modal.show();
}

function showAddPointsModal(userId, index) {
  if (!userId) {
    alert("Invalid user selected");
    return;
  }
  currentUserId = userId;
  currentRowIndex = index;
  const modal = new bootstrap.Modal(document.getElementById("addPointsModal"));
  modal.show();
}

function showReducePointsModal(userId, index) {
  currentUserId = userId;
  currentRowIndex = index;
  const modal = new bootstrap.Modal(
    document.getElementById("reducePointsModal")
  );
  modal.show();
}

// Add event listeners when document loads
document.addEventListener("DOMContentLoaded", () => {
  // Add EXP confirmation
  document
    .getElementById("confirmAddExp")
    .addEventListener("click", async () => {
      const expAmount = parseInt(document.getElementById("addExpInput").value);
      if (!expAmount || expAmount < 1) {
        alert("Please enter a valid EXP amount");
        return;
      }

      try {
        const response = await fetch("/api/admin/add-exp", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            user_id: currentUserId || null,
            display_id: currentDisplayId || null,
            exp_amount: parseInt(expAmount),
          }),
        });

        const result = await response.json();

        if (!response.ok) {
          if (response.status === 404) {
            throw new Error("Temporary user not found");
          } else {
            throw new Error(result.error || "Server error occurred");
          }
        }

        // Success case
        alert("EXP added successfully!");
        document.getElementById("addExpInput").value = "";
        bootstrap.Modal.getInstance(document.getElementById("addExpModal")).hide();
        await fetchLeaderboard();
      } catch (error) {
        console.error("Error adding EXP:", error);
        alert(`Failed to add EXP: ${error.message}`);
      }
    });

  // Reduce EXP confirmation
  document
    .getElementById("confirmReduceExp")
    .addEventListener("click", async () => {
      const expAmount = parseInt(
        document.getElementById("reduceExpInput").value
      );
      if (!expAmount || expAmount < 1) {
        alert("Please enter a valid EXP amount");
        return;
      }

      try {
        const response = await fetch("/api/admin/reduce-exp", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${localStorage.getItem("auth_token")}`,
          },
          body: JSON.stringify({
            user_id: currentUserId || null,
            display_id: currentDisplayId || null,
            exp_amount: expAmount,
          }),
        });

        const result = await response.json();

        if (!response.ok) {
          throw new Error(result.message || "Server error occurred");
        }

        if (result.success) {
          alert("EXP reduced successfully!");
          document.getElementById("reduceExpInput").value = "";
          bootstrap.Modal.getInstance(
            document.getElementById("reduceExpModal")
          ).hide();
          await fetchLeaderboard();
        }
      } catch (error) {
        console.error("Error reducing EXP:", error);
        alert(`Failed to reduce EXP: ${error.message}`);
      }
    });

  // Add Points confirmation
  document
    .getElementById("confirmAddPoints")
    .addEventListener("click", async () => {
      const pointsAmount = parseInt(
        document.getElementById("addPointsInput").value
      );
      if (!pointsAmount || pointsAmount < 1) {
        alert("Please enter a valid points amount");
        return;
      }

      try {
        const response = await fetch("/api/admin/add-points", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${localStorage.getItem("auth_token")}`,
          },
          body: JSON.stringify({
            user_id: currentUserId,
            points_amount: pointsAmount,
          }),
        });

        const result = await response.json();

        if (!response.ok) {
          throw new Error(result.message || "Server error occurred");
        }

        if (result.success) {
          alert("Points added successfully!");
          document.getElementById("addPointsInput").value = "";
          bootstrap.Modal.getInstance(
            document.getElementById("addPointsModal")
          ).hide();
          await fetchLeaderboard();
        }
      } catch (error) {
        console.error("Error adding points:", error);
        alert(`Failed to add points: ${error.message}`);
      }
    });

  // Reduce Points confirmation
  document
    .getElementById("confirmReducePoints")
    .addEventListener("click", async () => {
      const pointsAmount = parseInt(
        document.getElementById("reducePointsInput").value
      );
      if (!pointsAmount || pointsAmount < 1) {
        alert("Please enter a valid points amount");
        return;
      }

      try {
        const response = await fetch("/api/admin/reduce-points", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${localStorage.getItem("auth_token")}`,
          },
          body: JSON.stringify({
            user_id: currentUserId,
            points_amount: pointsAmount,
          }),
        });

        const result = await response.json();

        if (!response.ok) {
          throw new Error(result.message || "Server error occurred");
        }

        if (result.success) {
          alert("Points reduced successfully!");
          document.getElementById("reducePointsInput").value = "";
          bootstrap.Modal.getInstance(
            document.getElementById("reducePointsModal")
          ).hide();
          await fetchLeaderboard();
        }
      } catch (error) {
        console.error("Error reducing points:", error);
        alert(`Failed to reduce points: ${error.message}`);
      }
    });

  // Footer navigation
  const footerBtns = document.querySelectorAll(".footer-btn");
  const featureModal = new bootstrap.Modal(
    document.getElementById("featureModal")
  );

  footerBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      // Remove active class from all buttons
      footerBtns.forEach((b) => b.classList.remove("active"));
      // Add active class to clicked button
      btn.classList.add("active");

      // Get the button text to determine which page to load
      const page = btn.querySelector("span").textContent.toLowerCase();

      // Handle navigation
      switch (page) {
        case "leaderboard":
          window.location.href = "/";
          break;
        case "products":
        case "orders":
        case "accounts":
          // Show coming soon modal
          featureModal.show();
          // Remove active class and restore leaderboard as active
          setTimeout(() => {
            btn.classList.remove("active");
            footerBtns[0].classList.add("active");
          }, 300);
          break;
      }
    });
  });

  // Initialize WebSocket connection
  connectWebSocket();
});
