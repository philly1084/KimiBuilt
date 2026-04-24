/**
 * Prompt-driven voxel pet generator for the Web CLI.
 * Deterministic by prompt so the same seed recreates the same companion.
 */
(function initVoxelPets(global) {
    const DEFAULT_PROMPT = 'curious neon voxel builder companion';

    const SPECIES = ['fox', 'cat', 'dog', 'dragon', 'owl', 'bot', 'rabbit', 'panda', 'lizard', 'turtle'];
    const TRAITS = ['scout', 'builder', 'guardian', 'spark', 'mapper', 'scribe', 'tinker', 'pilot', 'forager', 'warden'];
    const NAMES = ['Blink', 'Cubix', 'Bit', 'Nova', 'Pixel', 'Bolt', 'Rivet', 'Byte', 'Vanta', 'Prism'];
    const RANDOM_ADJECTIVES = ['neon', 'cobalt', 'amber', 'chrome', 'jade', 'solar', 'glitch', 'lunar', 'ruby', 'frost'];
    const RANDOM_GEAR = ['goggles', 'jet boots', 'antenna', 'tool belt', 'signal cape', 'tiny scanner', 'light pack', 'work gloves'];
    const RANDOM_BIOMES = ['moon quarry', 'server garden', 'sky forge', 'crystal mine', 'rainy arcade', 'terminal bay'];
    const PALETTES = [
        { name: 'mint forge', primary: '#49d3a7', secondary: '#f4c95d', accent: '#ff6f91' },
        { name: 'cobalt kiln', primary: '#75b7ff', secondary: '#f4c95d', accent: '#ff7a59' },
        { name: 'ember grid', primary: '#ff8a4c', secondary: '#5eead4', accent: '#f06292' },
        { name: 'lime circuit', primary: '#a3e635', secondary: '#67e8f9', accent: '#fbbf24' },
        { name: 'rose quartz', primary: '#fb7185', secondary: '#93c5fd', accent: '#fef08a' },
        { name: 'ion violet', primary: '#a78bfa', secondary: '#2dd4bf', accent: '#f97316' },
    ];
    const MOODS = {
        ready: 'Ready',
        curious: 'Curious',
        thinking: 'Thinking',
        proud: 'Proud',
        sleepy: 'Sleepy',
        alert: 'Alert',
        playful: 'Playful',
    };

    function hashPrompt(input = '') {
        const source = String(input || DEFAULT_PROMPT).trim() || DEFAULT_PROMPT;
        let hash = 2166136261;

        for (let i = 0; i < source.length; i++) {
            hash ^= source.charCodeAt(i);
            hash = Math.imul(hash, 16777619);
        }

        return hash >>> 0;
    }

    function pick(list, hash, salt = 0) {
        return list[(hash + salt) % list.length];
    }

    function randomInt(max) {
        if (global.crypto?.getRandomValues) {
            const value = new Uint32Array(1);
            global.crypto.getRandomValues(value);
            return value[0] % max;
        }

        return Math.floor(Math.random() * max);
    }

    function randomPick(list) {
        return list[randomInt(list.length)];
    }

    function randomPrompt() {
        return [
            randomPick(RANDOM_ADJECTIVES),
            randomPick(SPECIES),
            randomPick(TRAITS),
            'with',
            randomPick(RANDOM_GEAR),
            'from the',
            randomPick(RANDOM_BIOMES),
        ].join(' ');
    }

    function generate(prompt = DEFAULT_PROMPT) {
        const seed = String(prompt || DEFAULT_PROMPT).trim() || DEFAULT_PROMPT;
        const hash = hashPrompt(seed);
        const species = pick(SPECIES, hash, 3);
        const trait = pick(TRAITS, hash >>> 3, 5);
        const palette = pick(PALETTES, hash >>> 7, 9);
        const ears = ['point', 'round', 'antenna', 'crest'][(hash >>> 15) % 4];
        const tail = ['stub', 'curl', 'saber', 'spark'][(hash >>> 18) % 4];
        const eyes = ['round', 'bright', 'sleepy', 'scan'][(hash >>> 21) % 4];

        return {
            id: `vox-${hash.toString(16).padStart(8, '0')}`,
            prompt: seed,
            name: `${pick(NAMES, hash >>> 11, 1)}-${(hash % 4096).toString(16).padStart(3, '0').toUpperCase()}`,
            species,
            trait,
            palette,
            ears,
            tail,
            eyes,
            mood: 'ready',
            energy: 74 + (hash % 21),
            createdAt: new Date().toISOString(),
            lastAction: 'spawned',
        };
    }

    function random() {
        return generate(randomPrompt());
    }

    function cleanChoice(value, allowed, fallback) {
        const normalized = String(value || '').trim().toLowerCase();
        return allowed.includes(normalized) ? normalized : fallback;
    }

    function cleanText(value, fallback, max = 28) {
        const text = String(value || '').trim().replace(/[^\w -]/g, '');
        return text ? text.slice(0, max) : fallback;
    }

    function cleanHex(value, fallback) {
        const color = String(value || '').trim();
        return /^#[0-9a-f]{6}$/i.test(color) ? color : fallback;
    }

    function fromSpec(spec, fallbackPrompt = DEFAULT_PROMPT) {
        const source = spec && typeof spec === 'object' ? spec : {};
        const prompt = String(source.prompt || source.description || fallbackPrompt || DEFAULT_PROMPT).trim() || DEFAULT_PROMPT;
        const fallback = generate(prompt);
        const sourcePalette = source.palette && typeof source.palette === 'object' ? source.palette : {};
        const palette = {
            name: cleanText(sourcePalette.name, fallback.palette.name, 32).toLowerCase(),
            primary: cleanHex(sourcePalette.primary, fallback.palette.primary),
            secondary: cleanHex(sourcePalette.secondary, fallback.palette.secondary),
            accent: cleanHex(sourcePalette.accent, fallback.palette.accent),
        };

        return normalize({
            ...fallback,
            id: `vox-ai-${hashPrompt(`${prompt}:${source.name || ''}`).toString(16).padStart(8, '0')}`,
            prompt,
            name: cleanText(source.name, fallback.name),
            species: cleanChoice(source.species, SPECIES, fallback.species),
            trait: cleanChoice(source.trait, TRAITS, fallback.trait),
            palette,
            ears: cleanChoice(source.ears, ['point', 'round', 'antenna', 'crest'], fallback.ears),
            tail: cleanChoice(source.tail, ['stub', 'curl', 'saber', 'spark'], fallback.tail),
            eyes: cleanChoice(source.eyes, ['round', 'bright', 'sleepy', 'scan'], fallback.eyes),
            mood: cleanChoice(source.mood, Object.keys(MOODS), 'ready'),
            energy: Number.isFinite(Number(source.energy)) ? Number(source.energy) : fallback.energy,
            createdAt: new Date().toISOString(),
            lastAction: 'AI-filled',
        });
    }

    function normalize(value) {
        if (!value || typeof value !== 'object') {
            return generate();
        }

        const fallback = generate(value.prompt || DEFAULT_PROMPT);
        const pet = {
            ...fallback,
            ...value,
            palette: value.palette && typeof value.palette === 'object' ? value.palette : fallback.palette,
        };
        pet.energy = Number.isFinite(Number(pet.energy)) ? Math.max(0, Math.min(100, Number(pet.energy))) : fallback.energy;
        pet.mood = MOODS[pet.mood] ? pet.mood : 'ready';
        return pet;
    }

    function cube(x, y, color, classes = '', z = 0, depth = 1) {
        return { x, y, z, depth, color, classes };
    }

    function petCells(petValue) {
        const pet = normalize(petValue);
        const p = 'var(--voxel-pet-primary)';
        const s = 'var(--voxel-pet-secondary)';
        const a = 'var(--voxel-pet-accent)';
        const dark = '#061013';
        const cells = [];

        const addRect = (x, y, w, h, color, classes = '', z = 0, depth = 1) => {
            for (let yy = 0; yy < h; yy++) {
                for (let xx = 0; xx < w; xx++) {
                    cells.push(cube(x + xx, y + yy, color, classes, z, depth));
                }
            }
        };

        if (pet.ears === 'point') {
            cells.push(cube(3, 0, a), cube(8, 0, a), cube(3, 1, a), cube(8, 1, a));
        } else if (pet.ears === 'antenna') {
            cells.push(cube(4, 0, a, 'spark'), cube(7, 0, a, 'spark'), cube(4, 1, s), cube(7, 1, s));
        } else if (pet.ears === 'crest') {
            cells.push(cube(5, 0, a), cube(6, 0, a), cube(4, 1, a), cube(7, 1, a));
        } else {
            addRect(3, 1, 2, 1, a);
            addRect(7, 1, 2, 1, a);
        }

        addRect(3, 2, 6, 4, p, 'head', 1, 1.15);
        addRect(4, 6, 4, 4, p, 'body', 0, 1.1);
        addRect(2, 7, 2, 2, s, 'paw', 1, 0.9);
        addRect(8, 7, 2, 2, s, 'paw', 1, 0.9);
        addRect(4, 10, 2, 2, s, 'foot', 0, 0.95);
        addRect(7, 10, 2, 2, s, 'foot', 0, 0.95);
        cells.push(cube(4, 4, dark, 'eye', 2, 0.62), cube(7, 4, dark, 'eye', 2, 0.62));

        if (pet.eyes === 'bright') {
            cells.push(cube(4, 3, '#ffffff', 'spark', 3, 0.55), cube(7, 3, '#ffffff', 'spark', 3, 0.55));
        } else if (pet.eyes === 'sleepy') {
            cells.push(cube(4, 5, dark, 'eye', 2, 0.58), cube(7, 5, dark, 'eye', 2, 0.58));
        } else if (pet.eyes === 'scan') {
            addRect(4, 4, 4, 1, dark, 'eye', 2, 0.58);
        }

        if (pet.species === 'dragon' || pet.species === 'lizard') {
            cells.push(cube(1, 6, a), cube(1, 7, a), cube(10, 6, a), cube(10, 7, a));
            cells.push(cube(5, 1, s), cube(6, 1, s));
        }

        if (pet.species === 'owl') {
            cells.push(cube(3, 3, s), cube(8, 3, s), cube(5, 5, a), cube(6, 5, a));
        }

        if (pet.species === 'bot') {
            addRect(2, 2, 8, 4, p);
            cells.push(cube(5, 0, a, 'spark'), cube(5, 1, s));
        }

        if (pet.tail === 'curl') {
            cells.push(cube(10, 8, s), cube(11, 8, s), cube(11, 7, s), cube(10, 6, s));
        } else if (pet.tail === 'saber') {
            cells.push(cube(10, 8, s), cube(11, 8, s), cube(12, 8, s), cube(13, 7, a));
        } else if (pet.tail === 'spark') {
            cells.push(cube(10, 8, s), cube(11, 8, a, 'spark'), cube(12, 7, a, 'spark'));
        } else {
            cells.push(cube(10, 8, s), cube(11, 8, s));
        }

        return cells;
    }

    function renderElement(petValue, options = {}) {
        const pet = normalize(petValue);
        const variant = ['full', 'mini', 'peek'].includes(options.variant) ? options.variant : 'full';
        const variantCube = {
            full: 18,
            mini: 4,
            peek: 6,
        };
        const cubeSize = Number.isFinite(Number(options.cubeSize))
            ? Number(options.cubeSize)
            : variantCube[variant];
        const wrapper = document.createElement('div');
        wrapper.className = `voxel-pet voxel-pet-${variant} action-${options.action || 'idle'}`;
        if (options.decorative) {
            wrapper.setAttribute('aria-hidden', 'true');
        } else {
            wrapper.setAttribute('aria-label', `${pet.name} the ${pet.trait} ${pet.species}`);
        }
        wrapper.style.setProperty('--cube', `${cubeSize}px`);
        wrapper.style.setProperty('--voxel-pet-primary', pet.palette.primary);
        wrapper.style.setProperty('--voxel-pet-secondary', pet.palette.secondary);
        wrapper.style.setProperty('--voxel-pet-accent', pet.palette.accent);
        wrapper.style.width = `${cubeSize * 15}px`;
        wrapper.style.height = `${cubeSize * 13}px`;

        const shadow = document.createElement('div');
        shadow.className = 'voxel-shadow';
        wrapper.appendChild(shadow);

        petCells(pet).forEach((cell) => {
            const maxDepth = variant === 'full' ? 3 : 2;
            const depthPx = Math.max(1, Math.min(maxDepth, Math.ceil((cell.depth || 1) * (cubeSize / 7))));
            const node = document.createElement('span');
            node.className = `voxel-cube ${cell.classes || ''}`.trim();
            node.style.setProperty('--x', String(cell.x));
            node.style.setProperty('--y', String(cell.y));
            node.style.setProperty('--z', String(cell.z || 0));
            node.style.setProperty('--x-px', `${cell.x * cubeSize}px`);
            node.style.setProperty('--y-px', `${cell.y * cubeSize}px`);
            node.style.setProperty('--z-px', `${cell.z || 0}px`);
            node.style.setProperty('--depth-px', `${depthPx}px`);
            node.style.setProperty('--half-depth-px', `${depthPx / 2}px`);
            node.style.setProperty('--color', cell.color);
            ['front', 'right', 'top'].forEach((face) => {
                const side = document.createElement('span');
                side.className = `voxel-face voxel-face-${face}`;
                node.appendChild(side);
            });
            wrapper.appendChild(node);
        });

        return wrapper;
    }

    function mutate(petValue, action = 'ready') {
        const pet = normalize(petValue);
        const normalized = String(action || 'ready').trim().toLowerCase();
        const update = {
            jump: { mood: 'playful', energy: -6, lastAction: 'jumped' },
            dance: { mood: 'playful', energy: -5, lastAction: 'danced' },
            sleep: { mood: 'sleepy', energy: 10, lastAction: 'napped' },
            nap: { mood: 'sleepy', energy: 10, lastAction: 'napped' },
            scout: { mood: 'curious', energy: -3, lastAction: 'scouted' },
            guard: { mood: 'alert', energy: -2, lastAction: 'guarded' },
            think: { mood: 'thinking', energy: -4, lastAction: 'computed' },
            proud: { mood: 'proud', energy: 2, lastAction: 'celebrated' },
            ready: { mood: 'ready', energy: 1, lastAction: 'ready' },
        }[normalized] || { mood: 'curious', energy: -1, lastAction: normalized };

        return {
            ...pet,
            mood: update.mood,
            energy: Math.max(0, Math.min(100, pet.energy + update.energy)),
            lastAction: update.lastAction,
            updatedAt: new Date().toISOString(),
        };
    }

    function reactToText(petValue, input = '') {
        const text = String(input || '').toLowerCase();
        if (text.includes('?')) return mutate(petValue, 'scout');
        if (/\b(build|make|create|generate|write|design|code|fix)\b/.test(text)) return mutate(petValue, 'think');
        if (/\b(thanks|thank you|nice|great|awesome|perfect)\b/.test(text)) return mutate(petValue, 'proud');
        return mutate(petValue, 'ready');
    }

    global.VoxelPets = {
        DEFAULT_PROMPT,
        MOODS,
        fromSpec,
        generate,
        hashPrompt,
        mutate,
        normalize,
        random,
        randomPrompt,
        reactToText,
        renderElement,
    };
})(window);
