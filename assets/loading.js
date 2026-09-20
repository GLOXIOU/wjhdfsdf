window.GlobalLoader = (() => {
    let activeCount = 0;
    const root = document.getElementById("global-loader");

    function show() {
        if (!root) return;
        activeCount += 1;
        root.classList.remove("hidden");
    }

    function hide(force = false) {
        if (!root) return;
        if (force) {
            activeCount = 0;
        } else {
            activeCount = Math.max(0, activeCount - 1);
        }
        if (activeCount === 0) {
            root.classList.add("hidden");
        }
    }

    async function run(task) {
        show();
        try {
            return await task();
        } finally {
            hide();
        }
    }

    return { show, hide, run };
})();
