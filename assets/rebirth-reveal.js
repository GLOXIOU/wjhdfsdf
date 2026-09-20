(function () {
    "use strict";

    const OLD_FLAG_KEY = "has_seen_v2_animation";
    const NEW_FLAG_KEY = "has_seen_v3_animation";

    if (localStorage.getItem(NEW_FLAG_KEY)) return;
    
    if (localStorage.getItem(OLD_FLAG_KEY)) {
        localStorage.removeItem(OLD_FLAG_KEY);
    }

    const style = document.createElement("style");
    style.textContent = `
        #brainrot-reveal-overlay {
            position: fixed;
            inset: 0;
            z-index: 99999;
            background: #05030a;
            display: flex;
            align-items: center;
            justify-content: center;
            font-family: 'Inter', system-ui, -apple-system, sans-serif;
            opacity: 0;
            visibility: hidden;
            transition: opacity 0.6s cubic-bezier(0.16, 1, 0.3, 1);
            overflow: hidden;
            padding: 1rem;
            box-sizing: border-box;
        }

        #brainrot-reveal-overlay.active {
            opacity: 1;
            visibility: visible;
        }

        #brainrot-reveal-overlay .br-bg-glow {
            position: absolute;
            width: 140vmax;
            height: 140vmax;
            background: radial-gradient(circle, rgba(168, 85, 247, 0.25) 0%, rgba(6, 182, 212, 0.15) 35%, rgba(5, 3, 10, 0) 70%);
            animation: brPulseGlow 8s ease-in-out infinite alternate;
            pointer-events: none;
        }

        #brainrot-reveal-overlay .br-grid-pattern {
            position: absolute;
            inset: -50%;
            width: 200%;
            height: 200%;
            background-image: 
                linear-gradient(rgba(168, 85, 247, 0.07) 1px, transparent 1px),
                linear-gradient(90deg, rgba(168, 85, 247, 0.07) 1px, transparent 1px);
            background-size: 50px 50px;
            transform: perspective(500px) rotateX(60deg);
            animation: brGridMove 12s linear infinite;
            pointer-events: none;
        }

        #brainrot-reveal-overlay canvas {
            position: absolute;
            inset: 0;
            pointer-events: none;
        }

        #brainrot-reveal-overlay .br-content {
            position: relative;
            z-index: 10;
            text-align: center;
            width: 100%;
            max-width: 680px;
            max-height: 92vh;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            box-sizing: border-box;
            overflow-y: auto;
            overflow-x: hidden;
            padding: 0.5rem;
            scrollbar-width: none;
        }

        #brainrot-reveal-overlay .br-content::-webkit-scrollbar {
            display: none;
        }

        #brainrot-reveal-overlay .br-tag {
            background: linear-gradient(135deg, #ec4899, #8b5cf6, #06b6d4);
            background-size: 200% 200%;
            animation: brGradientShift 4s ease infinite;
            color: #ffffff;
            padding: 6px 20px;
            border-radius: 99px;
            font-weight: 900;
            font-size: 0.85rem;
            text-transform: uppercase;
            letter-spacing: 2.5px;
            display: inline-block;
            margin-bottom: 0.75rem;
            transform: scale(0) translateY(-20px);
            box-shadow: 0 0 20px rgba(236, 72, 153, 0.5);
        }

        #brainrot-reveal-overlay.active .br-tag {
            animation: brPopInTag 0.5s 0.2s forwards cubic-bezier(0.34, 1.56, 0.64, 1), brGradientShift 4s ease infinite;
        }

        #brainrot-reveal-overlay .br-title {
            font-size: clamp(2.2rem, 7vw, 4.5rem);
            color: #ffffff;
            font-weight: 900;
            text-transform: uppercase;
            line-height: 0.95;
            letter-spacing: -1px;
            margin: 0 0 1.2rem 0;
            opacity: 0;
            transform: scale(0.5) blur(10px);
            text-shadow: 0 0 30px rgba(168, 85, 247, 0.6);
        }

        #brainrot-reveal-overlay .br-title-highlight {
            background: linear-gradient(135deg, #a855f7, #38bdf8, #ec4899);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            display: inline-block;
        }

        #brainrot-reveal-overlay.active .br-title {
            animation: brTitleZoom 0.7s 0.35s forwards cubic-bezier(0.16, 1, 0.3, 1);
        }

        #brainrot-reveal-overlay .br-grid {
            display: grid;
            grid-template-columns: repeat(3, minmax(0, 1fr));
            gap: 0.85rem;
            justify-content: center;
            width: 100%;
            margin-top: 0.5rem;
        }

        #brainrot-reveal-overlay .br-card {
            background: rgba(15, 10, 30, 0.55);
            border: 1px solid rgba(168, 85, 247, 0.25);
            backdrop-filter: blur(20px);
            -webkit-backdrop-filter: blur(20px);
            padding: 1rem 0.8rem;
            border-radius: 18px;
            opacity: 0;
            transform: translateY(30px) scale(0.9) rotateX(20deg);
            box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5), inset 0 1px 1px rgba(255, 255, 255, 0.1);
            transition: transform 0.3s cubic-bezier(0.16, 1, 0.3, 1), border-color 0.3s, box-shadow 0.3s;
        }

        #brainrot-reveal-overlay .br-card:hover {
            transform: translateY(-4px) scale(1.02);
            border-color: rgba(56, 189, 248, 0.6);
            box-shadow: 0 15px 35px rgba(168, 85, 247, 0.3), inset 0 1px 1px rgba(255, 255, 255, 0.2);
        }

        #brainrot-reveal-overlay.active .br-card:nth-child(1) { animation: brCardReveal 0.5s 0.6s forwards cubic-bezier(0.16, 1, 0.3, 1); }
        #brainrot-reveal-overlay.active .br-card:nth-child(2) { animation: brCardReveal 0.5s 0.7s forwards cubic-bezier(0.16, 1, 0.3, 1); }
        #brainrot-reveal-overlay.active .br-card:nth-child(3) { animation: brCardReveal 0.5s 0.8s forwards cubic-bezier(0.16, 1, 0.3, 1); }
        #brainrot-reveal-overlay.active .br-card:nth-child(4) { animation: brCardReveal 0.5s 0.9s forwards cubic-bezier(0.16, 1, 0.3, 1); }
        #brainrot-reveal-overlay.active .br-card:nth-child(5) { animation: brCardReveal 0.5s 1.0s forwards cubic-bezier(0.16, 1, 0.3, 1); }
        #brainrot-reveal-overlay.active .br-card:nth-child(6) { animation: brCardReveal 0.5s 1.1s forwards cubic-bezier(0.16, 1, 0.3, 1); }

        #brainrot-reveal-overlay .br-card-emoji {
            font-size: 1.8rem;
            margin-bottom: 0.3rem;
            display: inline-block;
            filter: drop-shadow(0 0 10px rgba(168, 85, 247, 0.5));
        }

        #brainrot-reveal-overlay .br-card h3 {
            font-size: 0.85rem;
            margin: 0 0 0.25rem 0;
            color: #38bdf8;
            font-weight: 800;
            letter-spacing: 0.3px;
        }

        #brainrot-reveal-overlay .br-card p {
            font-size: 0.72rem;
            color: #c084fc;
            line-height: 1.35;
            margin: 0;
            opacity: 0.85;
        }

        #brainrot-reveal-overlay .br-btn-row {
            display: flex;
            gap: 1rem;
            justify-content: center;
            align-items: center;
            width: 100%;
            max-width: 500px;
            margin-top: 1.5rem;
        }

        #brainrot-reveal-overlay .br-btn-ready {
            flex: 1;
            background: linear-gradient(135deg, #a855f7, #ec4899);
            color: #ffffff;
            border: none;
            padding: 0.95rem 1.5rem;
            font-size: 0.95rem;
            font-weight: 900;
            border-radius: 14px;
            cursor: pointer;
            text-transform: uppercase;
            letter-spacing: 1px;
            transform: translateY(20px);
            opacity: 0;
            box-shadow: 0 10px 25px rgba(168, 85, 247, 0.4);
            transition: transform 0.2s ease, box-shadow 0.2s ease, filter 0.2s ease;
        }

        #brainrot-reveal-overlay.active .br-btn-ready {
            animation: brBtnSlideUp 0.5s 1.3s forwards cubic-bezier(0.16, 1, 0.3, 1);
        }

        #brainrot-reveal-overlay .br-btn-ready:hover {
            transform: translateY(-2px) scale(1.02);
            filter: brightness(1.15);
            box-shadow: 0 15px 30px rgba(236, 72, 153, 0.5);
        }

        #brainrot-reveal-overlay .br-btn-link {
            flex: 1;
            background: rgba(255, 255, 255, 0.03);
            color: #38bdf8;
            border: 1px solid rgba(56, 189, 248, 0.4);
            padding: 0.95rem 1.5rem;
            font-size: 0.9rem;
            font-weight: 800;
            border-radius: 14px;
            cursor: pointer;
            text-transform: uppercase;
            letter-spacing: 1px;
            transform: translateY(20px);
            opacity: 0;
            text-decoration: none;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            gap: 0.5rem;
            backdrop-filter: blur(10px);
            transition: background 0.2s, border-color 0.2s, transform 0.2s;
        }

        #brainrot-reveal-overlay.active .br-btn-link {
            animation: brBtnSlideUp 0.5s 1.4s forwards cubic-bezier(0.16, 1, 0.3, 1);
        }

        #brainrot-reveal-overlay .br-btn-link:hover {
            background: rgba(56, 189, 248, 0.12);
            border-color: #38bdf8;
            transform: translateY(-2px);
        }

        @keyframes brPulseGlow {
            0% { transform: scale(0.9); opacity: 0.6; }
            100% { transform: scale(1.1); opacity: 1; }
        }

        @keyframes brGridMove {
            0% { transform: perspective(500px) rotateX(60deg) translateY(0); }
            100% { transform: perspective(500px) rotateX(60deg) translateY(50px); }
        }

        @keyframes brGradientShift {
            0% { background-position: 0% 50%; }
            50% { background-position: 100% 50%; }
            100% { background-position: 0% 50%; }
        }

        @keyframes brPopInTag {
            to { transform: scale(1) translateY(0); }
        }

        @keyframes brTitleZoom {
            to { opacity: 1; transform: scale(1) blur(0); }
        }

        @keyframes brCardReveal {
            to { opacity: 1; transform: translateY(0) scale(1) rotateX(0deg); }
        }

        @keyframes brBtnSlideUp {
            to { opacity: 1; transform: translateY(0); }
        }

        @media (max-width: 1024px) {
            #brainrot-reveal-overlay .br-content {
                max-width: 600px;
            }
            #brainrot-reveal-overlay .br-grid {
                grid-template-columns: repeat(3, minmax(0, 1fr));
                gap: 0.75rem;
            }
        }

        @media (max-width: 768px) {
            #brainrot-reveal-overlay .br-grid {
                grid-template-columns: repeat(2, minmax(0, 1fr));
                gap: 0.65rem;
            }
            #brainrot-reveal-overlay .br-card {
                padding: 0.85rem 0.6rem;
            }
            #brainrot-reveal-overlay .br-btn-row {
                flex-direction: column;
                gap: 0.65rem;
            }
            #brainrot-reveal-overlay .br-btn-ready,
            #brainrot-reveal-overlay .br-btn-link {
                width: 100%;
                padding: 0.85rem 1rem;
            }
        }

        @media (max-width: 480px) {
            #brainrot-reveal-overlay .br-grid {
                grid-template-columns: repeat(2, minmax(0, 1fr));
            }
            #brainrot-reveal-overlay .br-card h3 {
                font-size: 0.78rem;
            }
            #brainrot-reveal-overlay .br-card p {
                font-size: 0.68rem;
            }
            #brainrot-reveal-overlay .br-title {
                font-size: 2.2rem;
            }
        }
    `;
    document.head.appendChild(style);

    const overlay = document.createElement("div");
    overlay.id = "brainrot-reveal-overlay";
    overlay.innerHTML = `
        <div class="br-bg-glow"></div>
        <div class="br-grid-pattern"></div>
        <canvas id="br-particles"></canvas>

        <div class="br-content" id="br-content">
            <span class="br-tag">Mise à jour v3.0.0</span>
            <h1 class="br-title">La saison<br><span class="br-title-highlight">V3 est là !</span></h1>

            <div class="br-grid">
                <div class="br-card">
                    <span class="br-card-emoji">⚡</span>
                    <h3>Reset total</h3>
                    <p>Remise à zéro complète pour tous les joueurs.</p>
                </div>
                <div class="br-card">
                    <span class="br-card-emoji">🌐</span>
                    <h3>PlayWeb</h3>
                    <p>Intégration et synchronisation sur PlayWeb.</p>
                </div>
                <div class="br-card">
                    <span class="br-card-emoji">🃏</span>
                    <h3>Saison 3</h3>
                    <p>Arrivée des nouveaux brainrots exclusifs.</p>
                </div>
                <div class="br-card">
                    <span class="br-card-emoji">🛠️</span>
                    <h3>Multi réparé</h3>
                    <p>Le mode multijoueur est 100% fonctionnel.</p>
                </div>
                <div class="br-card">
                    <span class="br-card-emoji">🏪</span>
                    <h3>Marché</h3>
                    <p>Le tout nouveau marché du brainrot est ouvert.</p>
                </div>
                <div class="br-card">
                    <span class="br-card-emoji">🔧</span>
                    <h3>Correctifs</h3>
                    <p>Plein de petits fix pour améliorer l'expérience.</p>
                </div>
            </div>

            <div class="br-btn-row">
                <button class="br-btn-ready" id="br-close-btn">C'EST COMPRIS !</button>
                <a
                    class="br-btn-link"
                    href="https://llextv.github.io/PlayWeb.front/mises-a-jour/index.html"
                    target="_blank"
                    rel="noopener"
                >
                    🔗 Voir la mise à jour
                </a>
            </div>
        </div>
    `;
    document.body.appendChild(overlay);

    const canvas = document.getElementById("br-particles");
    const ctx = canvas.getContext("2d");
    let particles = [];

    function resizeCanvas() {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
    }
    window.addEventListener("resize", resizeCanvas);
    resizeCanvas();

    class NeonParticle {
        constructor() {
            this.reset();
        }

        reset() {
            this.x = Math.random() * canvas.width;
            this.y = Math.random() * canvas.height;
            this.size = Math.random() * 2.5 + 0.5;
            this.vx = (Math.random() - 0.5) * 0.8;
            this.vy = -Math.random() * 1.5 - 0.3;
            this.alpha = Math.random() * 0.7 + 0.3;
            const colors = ['#a855f7', '#38bdf8', '#ec4899', '#c084fc'];
            this.color = colors[Math.floor(Math.random() * colors.length)];
        }

        update() {
            this.x += this.vx;
            this.y += this.vy;
            this.alpha -= 0.003;

            if (this.y < 0 || this.alpha <= 0) {
                this.reset();
                this.y = canvas.height + 10;
            }
        }

        draw() {
            ctx.save();
            ctx.globalAlpha = this.alpha;
            ctx.fillStyle = this.color;
            ctx.shadowBlur = 12;
            ctx.shadowColor = this.color;
            ctx.beginPath();
            ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        }
    }

    const particleCount = Math.min(Math.floor(window.innerWidth / 15), 70);
    for (let i = 0; i < particleCount; i++) {
        particles.push(new NeonParticle());
    }

    function animateParticles() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        particles.forEach(p => {
            p.update();
            p.draw();
        });
        requestAnimationFrame(animateParticles);
    }
    animateParticles();

    function startReveal() {
        setTimeout(() => {
            overlay.classList.add("active");
        }, 100);
    }

    function closeReveal() {
        overlay.style.opacity = "0";
        setTimeout(() => {
            overlay.classList.remove("active");
            overlay.style.opacity = "";
            overlay.style.display = "none";
            localStorage.setItem(NEW_FLAG_KEY, "1");
            if (localStorage.getItem(OLD_FLAG_KEY)) {
                localStorage.removeItem(OLD_FLAG_KEY);
            }
        }, 600);
    }

    document.getElementById("br-close-btn").addEventListener("click", closeReveal);
    overlay.addEventListener("click", function (e) {
        if (e.target === overlay) closeReveal();
    });

    setTimeout(startReveal, 300);
})();