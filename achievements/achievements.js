const categoriesRoot = document.getElementById("achievements-categories");
const progressNode = document.getElementById("achievements-progress");

function titleCase(value) {
    return String(value || "")
        .replace(/_/g, " ")
        .replace(/-/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .replace(/^\w|\s\w/g, (m) => m.toUpperCase());
}

function getUnlockedSet() {
    const keys = [
        "brainrot_unlocked_achievements",
        "brainrot_achievements",
        "achievements_unlocked",
        "unlockedAchievements"
    ];

    for (const key of keys) {
        try {
            const raw = localStorage.getItem(key);
            if (!raw) continue;
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) return new Set(parsed.map(String));
        } catch {
            // ignore malformed local storage entries
        }
    }

    return new Set(["coll1", "play1", "rar_commun", "fight1"]);
}

function renderAchievementCard(achievement, unlockedSet) {
    const unlocked = unlockedSet.has(String(achievement.id));
    const card = document.createElement("article");
    card.className = `achievement-card ${unlocked ? "unlocked" : "locked"}`;

    card.innerHTML = `
        <div class="achievement-icon">
            <i data-lucide="${unlocked ? "badge-check" : "trophy"}"></i>
        </div>
        <div class="achievement-body">
            <div class="achievement-name">${achievement.name}</div>
            <div class="achievement-desc">${achievement.description}</div>
        </div>
        ${unlocked ? "" : `<span class="lock-badge"><i data-lucide="lock"></i></span>`}
    `;

    return card;
}

function renderCategories(data) {
    const unlockedSet = getUnlockedSet();
    const all = Array.isArray(data?.achievements) ? data.achievements : [];
    const total = all.length;
    const unlockedCount = all.filter((a) => unlockedSet.has(String(a.id))).length;

    progressNode.textContent = `${unlockedCount} / ${total} achievements débloqués`;

    const grouped = data?.grouped && typeof data.grouped === "object" ? data.grouped : {};
    const categories = Array.isArray(data?.categories) ? data.categories : Object.keys(grouped);

    categoriesRoot.innerHTML = "";

    categories.forEach((categoryKey) => {
        const list = Array.isArray(grouped[categoryKey])
            ? grouped[categoryKey]
            : all.filter((a) => a.category === categoryKey);

        const unlockedInCat = list.filter((a) => unlockedSet.has(String(a.id))).length;

        const section = document.createElement("section");
        section.className = "category-card";
        section.innerHTML = `
            <div class="category-title">
                <h2>${titleCase(categoryKey)}</h2>
                <span class="category-count">${unlockedInCat}/${list.length}</span>
            </div>
            <div class="achievements-grid"></div>
        `;

        const grid = section.querySelector(".achievements-grid");
        list.forEach((achievement) => {
            grid.appendChild(renderAchievementCard(achievement, unlockedSet));
        });

        categoriesRoot.appendChild(section);
    });

    lucide.createIcons();
}

async function loadAchievements() {
    GlobalLoader.show();
    try {
        const response = await fetch(window.API_BASE_URL + "/api/achievements");
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        renderCategories(data);
    } catch (error) {
        console.error("Erreur chargement achievements:", error);
        progressNode.textContent = "Impossible de charger les achievements.";
        categoriesRoot.innerHTML = `
            <section class="category-card">
                <p style="color:#fda4af;font-weight:700;margin-bottom:0.5rem;">⚠️ Erreur de chargement</p>
                <p style="color:var(--text-muted);font-size:0.9rem;">
                    Le backend n'est pas disponible. Lance <code style="background:#262626;padding:0.2rem 0.4rem;border-radius:4px;">npm run dev</code> dans le dossier backend.
                </p>
            </section>
        `;
    } finally {
        GlobalLoader.hide(true);
    }
}

document.addEventListener("DOMContentLoaded", () => {
    lucide.createIcons();
    loadAchievements();
});

