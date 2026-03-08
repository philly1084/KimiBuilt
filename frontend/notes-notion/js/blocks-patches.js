(function() {
    'use strict';

    if (typeof Blocks === 'undefined') {
        return;
    }

    const SAFE_BLOCK_ICONS = {
        text: '\u{1F4DD}',
        bulleted_list: '\u2022',
        todo: '\u2610',
        toggle: '\u25B6',
        divider: '\u2014',
        callout: '\u{1F4A1}',
        image: '\u{1F5BC}',
        ai_image: '\u{1F3A8}',
        bookmark: '\u{1F517}',
        database: '\u{1F4CA}',
        math: '\u2211',
        ai: '\u2728',
    };

    const SAFE_EMOJIS = {
        recent: ['\u{1F44B}', '\u{1F4DD}', '\u{1F4A1}', '\u2705', '\u{1F4CC}', '\u2B50', '\u{1F525}', '\u2764\uFE0F'],
        smileys: ['\u{1F600}', '\u{1F603}', '\u{1F604}', '\u{1F60A}', '\u{1F609}', '\u{1F60D}', '\u{1F917}', '\u{1F642}'],
        people: ['\u{1F44B}', '\u{1F44D}', '\u{1F64C}', '\u{1F64F}', '\u{1F4AA}', '\u{1F9E0}', '\u{1F440}', '\u{1F5E3}'],
        animals: ['\u{1F431}', '\u{1F436}', '\u{1F98A}', '\u{1F43B}', '\u{1F42F}', '\u{1F984}', '\u{1F98B}', '\u{1F426}'],
        food: ['\u{1F34E}', '\u{1F355}', '\u{1F354}', '\u{1F35C}', '\u{1F363}', '\u{1F370}', '\u2615', '\u{1F37A}'],
        activities: ['\u26BD', '\u{1F3C0}', '\u{1F3AE}', '\u{1F3A8}', '\u{1F3B5}', '\u{1F3AC}', '\u{1F3AF}', '\u{1F3C6}'],
        travel: ['\u{1F697}', '\u2708\uFE0F', '\u{1F680}', '\u{1F3D6}', '\u{1F3D4}', '\u{1F3E0}', '\u{1F3D9}', '\u{1F30D}'],
        objects: ['\u{1F4A1}', '\u{1F4BB}', '\u2328\uFE0F', '\u{1F4F1}', '\u{1F4F7}', '\u{1F4DA}', '\u{1F4CE}', '\u270F\uFE0F'],
        symbols: ['\u2764\uFE0F', '\u2705', '\u26A0\uFE0F', '\u2757', '\u2753', '\u2600\uFE0F', '\u2B06\uFE0F', '\u2B50'],
    };

    function isBrokenGlyph(value) {
        return /[\u00C2\u00C3\u00E2\u00F0]/.test(String(value || ''));
    }

    const blockTypes = Blocks.getBlockTypes();
    Object.entries(SAFE_BLOCK_ICONS).forEach(([type, icon]) => {
        if (blockTypes[type]) {
            blockTypes[type].icon = icon;
        }
    });

    Blocks.getEmojis = function(category = 'recent') {
        return SAFE_EMOJIS[category] || SAFE_EMOJIS.recent;
    };

    Blocks.getEmojiCategories = function() {
        return Object.keys(SAFE_EMOJIS);
    };

    const originalBulletedListRender = Blocks.render?.bulleted_list;
    if (typeof originalBulletedListRender === 'function') {
        Blocks.render.bulleted_list = function(block, index = 0, isEditable = true) {
            const node = originalBulletedListRender(block, index, isEditable);
            const bullet = node?.querySelector?.('.list-bullet');
            if (bullet) {
                bullet.textContent = '\u2022';
            }
            return node;
        };
    }

    const originalCalloutRender = Blocks.render?.callout;
    if (typeof originalCalloutRender === 'function') {
        Blocks.render.callout = function(block, isEditable = true) {
            const node = originalCalloutRender(block, isEditable);
            const icon = node?.querySelector?.('.callout-icon');
            if (icon && isBrokenGlyph(icon.textContent)) {
                icon.textContent = isBrokenGlyph(block?.icon) ? SAFE_BLOCK_ICONS.callout : (block?.icon || SAFE_BLOCK_ICONS.callout);
            }
            return node;
        };
    }
})();
