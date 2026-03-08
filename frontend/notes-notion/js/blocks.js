/**
 * Blocks Module - Block type definitions and rendering
 */

const Blocks = (function() {
    
    // Block type definitions
    const BLOCK_TYPES = {
        text: {
            name: 'Text',
            icon: '📝',
            placeholder: "Type '/' for commands",
            render: renderTextBlock
        },
        heading_1: {
            name: 'Heading 1',
            icon: 'H1',
            placeholder: 'Heading 1',
            render: renderTextBlock
        },
        heading_2: {
            name: 'Heading 2',
            icon: 'H2',
            placeholder: 'Heading 2',
            render: renderTextBlock
        },
        heading_3: {
            name: 'Heading 3',
            icon: 'H3',
            placeholder: 'Heading 3',
            render: renderTextBlock
        },
        bulleted_list: {
            name: 'Bulleted List',
            icon: '•',
            placeholder: 'List item',
            render: renderListBlock
        },
        numbered_list: {
            name: 'Numbered List',
            icon: '1.',
            placeholder: 'List item',
            render: renderListBlock
        },
        todo: {
            name: 'To-do',
            icon: '☐',
            placeholder: 'To-do',
            render: renderTodoBlock
        },
        toggle: {
            name: 'Toggle',
            icon: '▶',
            placeholder: 'Toggle',
            render: renderToggleBlock
        },
        quote: {
            name: 'Quote',
            icon: '"',
            placeholder: 'Empty quote',
            render: renderTextBlock
        },
        divider: {
            name: 'Divider',
            icon: '—',
            placeholder: '',
            render: renderDividerBlock
        },
        callout: {
            name: 'Callout',
            icon: '💡',
            placeholder: "Type '/' for commands",
            render: renderCalloutBlock
        },
        code: {
            name: 'Code',
            icon: '</>',
            placeholder: "Type '/' for commands",
            render: renderCodeBlock
        },
        image: {
            name: 'Image',
            icon: '🖼',
            placeholder: '',
            render: renderImageBlock
        },
        ai_image: {
            name: 'AI Image',
            icon: '🎨',
            placeholder: 'Generate an image with AI',
            render: renderAIImageBlock
        },
        bookmark: {
            name: 'Bookmark',
            icon: '🔗',
            placeholder: 'Paste link or search...',
            render: renderBookmarkBlock
        },
        database: {
            name: 'Database',
            icon: '📊',
            placeholder: '',
            render: renderDatabaseBlock
        },
        math: {
            name: 'Math Equation',
            icon: '∑',
            placeholder: 'Type LaTeX equation...',
            render: renderMathBlock
        },
        ai: {
            name: 'AI Assistant',
            icon: '✨',
            placeholder: 'Ask AI...',
            render: renderAIBlock
        }
    };
    
    // Emoji list for picker
    const EMOJIS = {
        recent: ['👋', '📝', '💡', '✅', '📌', '⭐', '🔥', '❤️', '🎉', '👍'],
        smileys: ['😀', '😃', '😄', '😁', '😅', '😂', '🤣', '😊', '😇', '🙂', '🙃', '😉', '😌', '😍', '🥰', '😘', '😗', '😙', '😚', '😋', '😛', '😝', '😜', '🤪', '🤨', '🧐', '🤓', '😎', '🥸', '🤩', '🥳', '😏', '😒', '😞', '😔', '😟', '😕', '🙁', '☹️', '😣', '😖', '😫', '😩', '🥺', '😢', '😭', '😤', '😠', '😡', '🤬', '🤯', '😳', '🥵', '🥶', '😱', '😨', '😰', '😥', '😓', '🤗', '🤔', '🤭', '🤫', '🤥', '😶', '😐', '😑', '😬', '🙄', '😯', '😦', '😧', '😮', '😲', '🥱', '😴', '🤤', '😪', '😵', '🤐', '🥴', '🤢', '🤮', '🤧', '😷', '🤒', '🤕'],
        people: ['👶', '👧', '🧒', '👦', '👩', '🧑', '👨', '👩‍🦱', '🧑‍🦱', '👨‍🦱', '👩‍🦰', '🧑‍🦰', '👨‍🦰', '👱‍♀️', '👱', '👱‍♂️', '👩‍🦳', '🧑‍🦳', '👨‍🦳', '👩‍🦲', '🧑‍🦲', '👨‍🦲', '🧔‍♀️', '🧔', '🧔‍♂️', '👵', '🧓', '👴', '👲', '👳‍♀️', '👳', '👳‍♂️', '🧕', '👮‍♀️', '👮', '👮‍♂️', '👷‍♀️', '👷', '👷‍♂️', '💂‍♀️', '💂', '💂‍♂️', '🕵️‍♀️', '🕵️', '🕵️‍♂️', '👩‍⚕️', '🧑‍⚕️', '👨‍⚕️', '👩‍🌾', '🧑‍🌾', '👨‍🌾', '👩‍🍳', '🧑‍🍳', '👨‍🍳', '👩‍🎓', '🧑‍🎓', '👨‍🎓', '👩‍🎤', '🧑‍🎤', '👨‍🎤', '👩‍🏫', '🧑‍🏫', '👨‍🏫', '👩‍🏭', '🧑‍🏭', '👨‍🏭', '👩‍💻', '🧑‍💻', '👨‍💻', '👩‍💼', '🧑‍💼', '👨‍💼', '👩‍🔧', '🧑‍🔧', '👨‍🔧', '👩‍🔬', '🧑‍🔬', '👨‍🔬', '👩‍🎨', '🧑‍🎨', '👨‍🎨', '👩‍🚒', '🧑‍🚒', '👨‍🚒', '👩‍✈️', '🧑‍✈️', '👨‍✈️', '👩‍🚀', '🧑‍🚀', '👨‍🚀', '👩‍⚖️', '🧑‍⚖️', '👨‍⚖️', '👰‍♀️', '👰', '👰‍♂️', '🤵‍♀️', '🤵', '🤵‍♂️', '👸', '🤴', '🥷', '🦸‍♀️', '🦸', '🦸‍♂️', '🦹‍♀️', '🦹', '🦹‍♂️', '🤶', '🧑‍🎄', '🎅', '🧙‍♀️', '🧙', '🧙‍♂️', '🧝‍♀️', '🧝', '🧝‍♂️', '🧛‍♀️', '🧛', '🧛‍♂️', '🧟‍♀️', '🧟', '🧟‍♂️', '🧞‍♀️', '🧞', '🧞‍♂️', '🧜‍♀️', '🧜', '🧜‍♂️', '🧚‍♀️', '🧚', '🧚‍♂️', '👼', '🤰', '🤱', '👩‍🍼', '🧑‍🍼', '👨‍🍼', '🙇‍♀️', '🙇', '🙇‍♂️', '💁‍♀️', '💁', '💁‍♂️', '🙅‍♀️', '🙅', '🙅‍♂️', '🙆‍♀️', '🙆', '🙆‍♂️', '🙋‍♀️', '🙋', '🙋‍♂️', '🧏‍♀️', '🧏', '🧏‍♂️', '🤦‍♀️', '🤦', '🤦‍♂️', '🤷‍♀️', '🤷', '🤷‍♂️', '🙎‍♀️', '🙎', '🙎‍♂️', '🙍‍♀️', '🙍', '🙍‍♂️', '💇‍♀️', '💇', '💇‍♂️', '💆‍♀️', '💆', '💆‍♂️', '💃', '🕺', '🛀', '🛌', '🧘‍♀️', '🧘', '🧘‍♂️', '🏃‍♀️', '🏃', '🏃‍♂️', '👫', '👭', '👬', '💑', '💏', '👪', '👋', '🤚', '🖐', '✋', '🖖', '👌', '🤌', '🤏', '✌️', '🤞', '🤟', '🤘', '🤙', '👈', '👉', '👆', '🖕', '👇', '☝️', '👍', '👎', '✊', '👊', '🤛', '🤜', '👏', '🙌', '👐', '🤲', '🤝', '🙏', '✍️', '💪', '🦾', '🦿', '🦵', '🦶', '👂', '🦻', '👃', '🧠', '🫀', '🫁', '🦷', '🦴', '👀', '👁', '👅', '👄', '💋', '🩸'],
        animals: ['🐶', '🐱', '🐭', '🐹', '🐰', '🦊', '🐻', '🐼', '🐻‍❄️', '🐨', '🐯', '🦁', '🐮', '🐷', '🐽', '🐸', '🐵', '🙈', '🙉', '🙊', '🐒', '🐔', '🐧', '🐦', '🐤', '🐣', '🐥', '🦆', '🦅', '🦉', '🦇', '🐺', '🐗', '🐴', '🦄', '🐝', '🐛', '🦋', '🐌', '🐞', '🐜', '🪰', '🪲', '🪳', '🦟', '🦗', '🕷', '🕸', '🦂', '🐢', '🐍', '🦎', '🦖', '🦕', '🐙', '🦑', '🦐', '🦞', '🦀', '🐡', '🐠', '🐟', '🐬', '🐳', '🐋', '🦈', '🐊', '🐅', '🐆', '🦓', '🦍', '🦧', '🐘', '🦛', '🦏', '🐪', '🐫', '🦒', '🦘', '🦬', '🐃', '🐂', '🐄', '🐎', '🐖', '🐏', '🐑', '🦙', '🐐', '🦌', '🐕', '🐩', '🦮', '🐕‍🦺', '🐈', '🐈‍⬛', '🪶', '🐓', '🦃', '🦤', '🦚', '🦜', '🦢', '🦩', '🕊', '🐇', '🦝', '🦨', '🦡', '🦫', '🦦', '🦥', '🐁', '🐀', '🐿', '🦔'],
        food: ['🍏', '🍎', '🍐', '🍊', '🍋', '🍌', '🍉', '🍇', '🍓', '🫐', '🍈', '🍒', '🍑', '🥭', '🍍', '🥥', '🥝', '🍅', '🍆', '🥑', '🥦', '🥬', '🥒', '🌶', '🫑', '🌽', '🥕', '🫒', '🧄', '🧅', '🥔', '🍠', '🥐', '🥯', '🍞', '🥖', '🥨', '🧀', '🥚', '🍳', '🧈', '🥞', '🧇', '🥓', '🥩', '🍗', '🍖', '🦴', '🌭', '🍔', '🍟', '🍕', '🫓', '🥪', '🥙', '🧆', '🌮', '🌯', '🫔', '🥗', '🥘', '🫕', '🥫', '🍝', '🍜', '🍲', '🍛', '🍣', '🍱', '🥟', '🦪', '🍤', '🍙', '🍚', '🍘', '🍥', '🥠', '🥮', '🍢', '🍡', '🍧', '🍨', '🍦', '🥧', '🧁', '🍰', '🎂', '🍮', '🍭', '🍬', '🍫', '🍿', '🍩', '🍪', '🌰', '🥜', '🍯', '🥛', '🍼', '🫖', '☕️', '🍵', '🧃', '🥤', '🧋', '🍶', '🍺', '🍻', '🥂', '🍷', '🥃', '🍸', '🍹', '🧉', '🍾', '🧊', '🥄', '🍴', '🍽', '🥣', '🥡', '🥢', '🧂'],
        activities: ['⚽️', '🏀', '🏈', '⚾️', '🥎', '🎾', '🏐', '🏉', '🥏', '🎱', '🪀', '🏓', '🏸', '🏒', '🏑', '🥍', '🏏', '🪃', '🥅', '⛳️', '🪁', '🏹', '🎣', '🤿', '🥊', '🥋', '🎽', '🛹', '🛼', '🛷', '⛸', '🥌', '🎿', '⛷', '🏂', '🪂', '🏋️‍♀️', '🏋️', '🏋️‍♂️', '🤼‍♀️', '🤼', '🤼‍♂️', '🤸‍♀️', '🤸', '🤸‍♂️', '⛹️‍♀️', '⛹️', '⛹️‍♂️', '🤺', '🤾‍♀️', '🤾', '🤾‍♂️', '🏌️‍♀️', '🏌️', '🏌️‍♂️', '🏇', '🧘‍♀️', '🧘', '🧘‍♂️', '🏄‍♀️', '🏄', '🏄‍♂️', '🏊‍♀️', '🏊', '🏊‍♂️', '🤽‍♀️', '🤽', '🤽‍♂️', '🚣‍♀️', '🚣', '🚣‍♂️', '🧗‍♀️', '🧗', '🧗‍♂️', '🚵‍♀️', '🚵', '🚵‍♂️', '🚴‍♀️', '🚴', '🚴‍♂️', '🏆', '🥇', '🥈', '🥉', '🏅', '🎖', '🏵', '🎗', '🎫', '🎟', '🎪', '🤹‍♀️', '🤹', '🤹‍♂️', '🎭', '🩰', '🎨', '🎬', '🎤', '🎧', '🎼', '🎹', '🥁', '🪘', '🎷', '🎺', '🪗', '🎸', '🪕', '🎻', '🎲', '♟', '🎯', '🎳', '🎮', '🎰', '🧩'],
        travel: ['🚗', '🚕', '🚙', '🚌', '🚎', '🏎', '🚓', '🚑', '🚒', '🚐', '🛻', '🚚', '🚛', '🚜', '🦯', '🦽', '🦼', '🛴', '🚲', '🛵', '🏍', '🛺', '🚨', '🚔', '🚍', '🚘', '🚖', '🚡', '🚠', '🚟', '🚃', '🚋', '🚞', '🚝', '🚄', '🚅', '🚈', '🚂', '🚆', '🚇', '🚊', '🚉', '✈️', '🛫', '🛬', '🛩', '💺', '🛰', '🚀', '🛸', '🚁', '🛶', '⛵️', '🚤', '🛥', '🛳', '⛴', '🚢', '⚓️', '⛽️', '🚧', '🚦', '🚥', '🚏', '🗺', '🗿', '🗽', '🗼', '🏰', '🏯', '🏟', '🎡', '🎢', '🎠', '⛲️', '⛱', '🏖', '🏝', '🏜', '🌋', '⛰', '🏔', '🗻', '🏕', '⛺️', '🛖', '🏠', '🏡', '🏘', '🏚', '🏗', '🏭', '🏢', '🏬', '🏣', '🏤', '🏥', '🏦', '🏨', '🏪', '🏫', '🏩', '💒', '🏛', '⛪️', '🕌', '🕍', '🛕', '🕋', '⛩', '🛤', '🛣', '🗾', '🎑', '🏞', '🌅', '🌄', '🌠', '🎇', '🎆', '🌇', '🌆', '🏙', '🌃', '🌌', '🌉', '🌁'],
        objects: ['⌚️', '📱', '📲', '💻', '⌨️', '🖥', '🖨', '🖱', '🖲', '🕹', '🗜', '💽', '💾', '💿', '📀', '📼', '📷', '📸', '📹', '🎥', '📽', '🎞', '📞', '☎️', '📟', '📠', '📺', '📻', '🎙', '🎚', '🎛', '🧭', '⏱', '⏲', '⏰', '🕰', '⌛️', '⏳', '📡', '🔋', '🔌', '💡', '🔦', '🕯', '🪔', '🧯', '🛢', '💸', '💵', '💴', '💶', '💷', '🪙', '💰', '💳', '💎', '⚖️', '🪜', '🧰', '🪛', '🔧', '🔨', '⚒', '🛠', '⛏', '🪚', '🔩', '⚙️', '🪤', '🧱', '⛓', '🧲', '🔫', '💣', '🧨', '🪓', '🔪', '🗡', '⚔️', '🛡', '🚬', '⚰️', '🪦', '⚱️', '🏺', '🔮', '📿', '🧿', '💎', '🔔', '🔕', '📢', '📣', '📯', '🔔', '🎊', '🎉', '🎈', '🎀', '🎁', '🎗', '🏷', '🔖', '📑', '📯', '📜', '📃', '📄', '📑', '📊', '📈', '📉', '🗒', '🗓', '📆', '📅', '🗑', '📇', '🗃', '🗳', '🗄', '📋', '📁', '📂', '🗂', '🗞', '📰', '📓', '📔', '📒', '📕', '📗', '📘', '📙', '📚', '📖', '🔖', '🧷', '🔗', '📎', '🖇', '📐', '📏', '🧮', '📌', '📍', '✂️', '🖊', '🖋', '✒️', '🖌', '🖍', '📝', '✏️', '🔍', '🔎', '🔏', '🔐', '🔒', '🔓', '❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '🤎', '💔', '❣️', '💕', '💞', '💓', '💗', '💖', '💘', '💝'],
        symbols: ['❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '🤎', '💔', '❣️', '💕', '💞', '💓', '💗', '💖', '💘', '💝', '💟', '☮️', '✝️', '☪️', '🕉', '☸️', '✡️', '🔯', '🕎', '☯️', '☦️', '🛐', '⛎', '♈️', '♉️', '♊️', '♋️', '♌️', '♍️', '♎️', '♏️', '♐️', '♑️', '♒️', '♓️', '🆔', '⚛️', '🉑', '☢️', '☣️', '📴', '📳', '🈶', '🈚️', '🈸', '🈺', '🈷️', '✴️', '🆚', '💮', '🉐', '㊙️', '㊗️', '🈴', '🈵', '🈹', '🈲', '🅰️', '🅱️', '🆎', '🆑', '🅾️', '🆘', '❌', '⭕️', '🛑', '⛔️', '📛', '🚫', '💯', '💢', '♨️', '🚷', '🚯', '🚳', '🚱', '🔞', '📵', '🚭', '❗️', '❕', '❓', '❔', '‼️', '⁉️', '🔅', '🔆', '〽️', '⚠️', '🚸', '🔱', '⚜️', '🔰', '♻️', '✅', '🈯️', '💹', '❇️', '✳️', '❎', '🌐', '💠', 'Ⓜ️', '🌀', '💤', '🏧', '🚾', '♿️', '🅿️', '🈳', '🈂', '🛂', '🛃', '🛄', '🛅', '🛗', '🚹', '🚺', '🚼', '⚧', '🚻', '🚮', '🎦', '📶', '🈁', '🔣', 'ℹ️', '🔤', '🔡', '🔠', '🆖', '🆗', '🆙', '🆒', '🆕', '🆓', '0️⃣', '1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟', '🔢', '#️⃣', '*️⃣', '⏏️', '▶️', '⏸', '⏯', '⏹', '⏺', '⏭', '⏮', '⏩', '⏪', '⏫', '⏬', '◀️', '🔼', '🔽', '➡️', '⬅️', '⬆️', '⬇️', '↗️', '↘️', '↙️', '↖️', '↕️', '↔️', '↪️', '↩️', '⤴️', '⤵️', '🔀', '🔁', '🔂', '🔄', '🔃', '🎵', '🎶', '➕', '➖', '➗', '✖️', '💲', '💱', '™️', '©️', '®️', '〰️', '➰', '➿', '🔚', '🔙', '🔛', '🔝', '🔜', '✔️', '☑️', '🔘', '🔴', '🟠', '🟡', '🟢', '🔵', '🟣', '⚫️', '⚪️', '🟤', '🔺', '🔻', '🔸', '🔹', '🔶', '🔷', '🔳', '🔲', '▪️', '▫️', '◾️', '◽️', '◼️', '◻️', '🟥', '🟧', '🟨', '🟩', '🟦', '🟪', '⬛️', '⬜️', '🟫', '🔈', '🔇', '🔉', '🔊', '🔔', '🔕', '📣', '📢', '💬', '💭', '🗯', '♠️', '♣️', '♥️', '♦️', '🃏', '🎴', '🀄️', '🕐', '🕑', '🕒', '🕓', '🕔', '🕕', '🕖', '🕗', '🕘', '🕙', '🕚', '🕛', '🕜', '🕝', '🕞', '🕟', '🕠', '🕡', '🕢', '🕣', '🕤', '🕥', '🕦', '🕧']
    };
    
    // Default model configuration
    const DEFAULT_MODEL = 'gpt-4o';
    const DEFAULT_IMAGE_MODEL = 'dall-e-3';
    
    /**
     * Create a new block
     */
    function createBlock(type = 'text', content = '', options = {}) {
        const id = Storage.generateBlockId();
        return {
            id,
            type,
            content,
            children: options.children || [],
            formatting: options.formatting || {},
            color: options.color || null,
            createdAt: Date.now(),
            ...options
        };
    }
    
    /**
     * Get default model for AI operations
     */
    function getDefaultModel() {
        return DEFAULT_MODEL;
    }
    
    /**
     * Get default image model
     */
    function getDefaultImageModel() {
        return DEFAULT_IMAGE_MODEL;
    }
    
    /**
     * Helper: Safely extract text from API response
     * This fixes the [object Object] display issue
     */
    function extractResponseText(result) {
        if (result === null || result === undefined) {
            return '';
        }
        
        if (typeof result === 'string') {
            return result;
        }
        
        if (typeof result === 'object') {
            // Try common response formats
            if (result.response && typeof result.response === 'string') {
                return result.response;
            }
            if (result.text && typeof result.text === 'string') {
                return result.text;
            }
            if (result.content && typeof result.content === 'string') {
                return result.content;
            }
            if (result.message && typeof result.message === 'string') {
                return result.message;
            }
            if (result.output && typeof result.output === 'string') {
                return result.output;
            }
            // Deep extraction for nested objects
            const text = findTextInObject(result);
            if (text) return text;
        }
        
        // Fallback: convert to string but avoid [object Object]
        try {
            const str = JSON.stringify(result);
            if (str !== '{}' && str !== '[]') {
                return str;
            }
        } catch (e) {
            // Ignore JSON stringify errors
        }
        
        return '';
    }
    
    /**
     * Recursively search for text content in an object
     */
    function findTextInObject(obj, depth = 0) {
        if (depth > 5) return null; // Prevent infinite recursion
        
        if (typeof obj === 'string' && obj.length > 0) {
            return obj;
        }
        
        if (typeof obj === 'object' && obj !== null) {
            // Check common text keys first
            const textKeys = ['text', 'content', 'response', 'message', 'output', 'value', 'data'];
            for (const key of textKeys) {
                if (obj[key] && typeof obj[key] === 'string' && obj[key].length > 0) {
                    return obj[key];
                }
            }
            
            // Deep search in nested objects
            for (const key in obj) {
                if (obj.hasOwnProperty(key)) {
                    const found = findTextInObject(obj[key], depth + 1);
                    if (found) return found;
                }
            }
        }
        
        return null;
    }
    
    /**
     * Render a text-based block (text, headings, quote)
     */
    function renderTextBlock(block, isEditable = true) {
        const type = BLOCK_TYPES[block.type];
        const input = document.createElement('div');
        input.className = 'block-input';
        input.contentEditable = isEditable;
        input.dataset.blockId = block.id;
        
        if (block.content) {
            input.innerHTML = formatContent(block.content, block.formatting);
        }
        
        // Always set placeholder for empty blocks
        input.dataset.placeholder = type.placeholder;
        
        return input;
    }
    
    /**
     * Render a list block (bulleted, numbered)
     */
    function renderListBlock(block, index = 0, isEditable = true) {
        const wrapper = document.createElement('div');
        wrapper.className = 'block-content';
        
        const bullet = document.createElement('span');
        bullet.className = block.type === 'bulleted_list' ? 'list-bullet' : 'list-number';
        bullet.textContent = block.type === 'bulleted_list' ? '•' : `${index + 1}.`;
        
        const input = document.createElement('div');
        input.className = 'block-input';
        input.contentEditable = isEditable;
        input.dataset.blockId = block.id;
        input.innerHTML = formatContent(block.content, block.formatting) || '';
        
        const type = BLOCK_TYPES[block.type];
        input.dataset.placeholder = type.placeholder;
        
        wrapper.appendChild(bullet);
        wrapper.appendChild(input);
        
        return wrapper;
    }
    
    /**
     * Render a todo block
     */
    function renderTodoBlock(block, isEditable = true) {
        const wrapper = document.createElement('div');
        wrapper.className = 'block-content';
        
        const checkbox = document.createElement('div');
        checkbox.className = 'todo-checkbox';
        
        const content = typeof block.content === 'object' ? block.content : { text: block.content, checked: false };
        
        if (content.checked) {
            checkbox.classList.add('checked');
        }
        
        checkbox.addEventListener('click', () => {
            checkbox.classList.toggle('checked');
            block.content = { ...content, checked: !content.checked };
            wrapper.closest('.block').classList.toggle('checked', !content.checked);
            
            // Trigger save
            if (window.Editor) {
                window.Editor.savePage();
            }
        });
        
        const input = document.createElement('div');
        input.className = 'block-input';
        input.contentEditable = isEditable;
        input.dataset.blockId = block.id;
        input.innerHTML = formatContent(content.text, block.formatting) || '';
        
        const type = BLOCK_TYPES[block.type];
        input.dataset.placeholder = type.placeholder;
        
        if (content.checked) {
            wrapper.closest('.block')?.classList.add('checked');
        }
        
        wrapper.appendChild(checkbox);
        wrapper.appendChild(input);
        
        return wrapper;
    }
    
    /**
     * Render a toggle block
     */
    function renderToggleBlock(block, isEditable = true) {
        const wrapper = document.createElement('div');
        wrapper.className = 'block-content';
        
        const arrow = document.createElement('div');
        arrow.className = 'toggle-arrow';
        arrow.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18l6-6-6-6"/></svg>';
        
        if (block.expanded !== false) {
            arrow.classList.add('expanded');
        }
        
        arrow.addEventListener('click', () => {
            arrow.classList.toggle('expanded');
            const children = wrapper.nextElementSibling;
            if (children && children.classList.contains('toggle-children')) {
                children.classList.toggle('collapsed', !arrow.classList.contains('expanded'));
            }
            block.expanded = arrow.classList.contains('expanded');
        });
        
        const input = document.createElement('div');
        input.className = 'block-input';
        input.contentEditable = isEditable;
        input.dataset.blockId = block.id;
        input.innerHTML = formatContent(block.content, block.formatting) || '';
        
        const type = BLOCK_TYPES[block.type];
        input.dataset.placeholder = type.placeholder;
        
        wrapper.appendChild(arrow);
        wrapper.appendChild(input);
        
        return wrapper;
    }
    
    /**
     * Render a divider block
     */
    function renderDividerBlock(block) {
        const wrapper = document.createElement('div');
        wrapper.className = 'block-content';
        
        const line = document.createElement('div');
        line.className = 'divider-line';
        
        wrapper.appendChild(line);
        return wrapper;
    }
    
    /**
     * Render a callout block
     */
    function renderCalloutBlock(block, isEditable = true) {
        const wrapper = document.createElement('div');
        wrapper.className = 'block-content';
        
        const icon = document.createElement('span');
        icon.className = 'callout-icon';
        icon.textContent = block.icon || '💡';
        icon.title = 'Click to change icon';
        
        icon.addEventListener('click', (e) => {
            e.stopPropagation();
            // Trigger emoji picker for callout icon
            if (window.Sidebar) {
                // Create a temporary picker
                const picker = document.getElementById('emoji-picker');
                if (picker) {
                    const rect = icon.getBoundingClientRect();
                    picker.style.left = `${rect.left}px`;
                    picker.style.top = `${rect.bottom + 8}px`;
                    picker.style.display = 'block';
                    
                    // Handle selection
                    const handleEmojiClick = (e) => {
                        const span = e.target.closest('.emoji-grid span');
                        if (span) {
                            block.icon = span.textContent;
                            icon.textContent = span.textContent;
                            picker.style.display = 'none';
                            document.removeEventListener('click', handleOutsideClick);
                            if (window.Editor) window.Editor.savePage();
                        }
                    };
                    
                    const handleOutsideClick = (e) => {
                        if (!picker.contains(e.target) && e.target !== icon) {
                            picker.style.display = 'none';
                            document.removeEventListener('click', handleOutsideClick);
                        }
                    };
                    
                    setTimeout(() => {
                        document.addEventListener('click', handleOutsideClick);
                    }, 0);
                }
            }
        });
        
        const input = document.createElement('div');
        input.className = 'block-input';
        input.contentEditable = isEditable;
        input.dataset.blockId = block.id;
        input.innerHTML = formatContent(block.content, block.formatting) || '';
        
        const type = BLOCK_TYPES[block.type];
        input.dataset.placeholder = type.placeholder;
        
        wrapper.appendChild(icon);
        wrapper.appendChild(input);
        
        return wrapper;
    }
    
    /**
     * Render a code block
     */
    function renderCodeBlock(block, isEditable = true) {
        const wrapper = document.createElement('div');
        wrapper.className = 'block-content';
        
        const header = document.createElement('div');
        header.className = 'code-header';
        
        const langSelect = document.createElement('select');
        langSelect.className = 'code-language';
        const languages = ['plain', 'javascript', 'typescript', 'python', 'html', 'css', 'json', 'sql', 'bash', 'markdown', 'java', 'cpp', 'rust', 'go', 'ruby', 'php', 'swift', 'kotlin'];
        languages.forEach(lang => {
            const option = document.createElement('option');
            option.value = lang;
            option.textContent = lang;
            langSelect.appendChild(option);
        });
        
        const content = typeof block.content === 'object' ? block.content : { language: 'plain', text: block.content || '' };
        langSelect.value = content.language || 'plain';
        
        langSelect.addEventListener('change', () => {
            block.content = { ...content, language: langSelect.value };
            // Re-highlight
            const codeEl = wrapper.querySelector('code');
            if (codeEl && window.hljs) {
                codeEl.className = `language-${langSelect.value}`;
                codeEl.textContent = content.text || '';
                window.hljs.highlightElement(codeEl);
            }
        });
        
        const copyBtn = document.createElement('button');
        copyBtn.className = 'code-copy';
        copyBtn.textContent = 'Copy';
        copyBtn.addEventListener('click', () => {
            navigator.clipboard.writeText(content.text || '');
            copyBtn.textContent = 'Copied!';
            setTimeout(() => copyBtn.textContent = 'Copy', 2000);
        });
        
        header.appendChild(langSelect);
        header.appendChild(copyBtn);
        
        const pre = document.createElement('pre');
        const code = document.createElement('code');
        code.className = `language-${content.language || 'plain'}`;
        code.textContent = content.text || '';
        
        if (isEditable) {
            code.contentEditable = true;
            code.addEventListener('blur', () => {
                block.content = { ...content, text: code.textContent };
                // Re-highlight
                if (window.hljs) {
                    window.hljs.highlightElement(code);
                }
            });
        }
        
        pre.appendChild(code);
        wrapper.appendChild(header);
        wrapper.appendChild(pre);
        
        // Apply syntax highlighting
        setTimeout(() => {
            if (window.hljs) {
                window.hljs.highlightElement(code);
            }
        }, 0);
        
        return wrapper;
    }
    
    /**
     * Render a math block (KaTeX)
     */
    function renderMathBlock(block, isEditable = true) {
        const wrapper = document.createElement('div');
        wrapper.className = 'block-content';
        
        const content = typeof block.content === 'object' ? block.content : { text: block.content || '', displayMode: true };
        
        if (isEditable && (!content.text || content.text.trim() === '')) {
            // Show input form for new equation
            const input = document.createElement('textarea');
            input.className = 'math-input';
            input.placeholder = 'Type LaTeX equation... (e.g., E = mc^2)';
            input.value = content.text || '';
            input.style.cssText = 'width: 100%; min-height: 60px; padding: 12px; font-family: monospace; font-size: 14px; border: 1px solid var(--border-color); border-radius: var(--radius-md); resize: vertical;';
            
            const renderBtn = document.createElement('button');
            renderBtn.className = 'ai-image-btn primary';
            renderBtn.textContent = 'Render Equation';
            renderBtn.style.marginTop = '8px';
            
            renderBtn.addEventListener('click', () => {
                const latex = input.value.trim();
                if (latex) {
                    block.content = { text: latex, displayMode: true };
                    wrapper.innerHTML = '';
                    wrapper.appendChild(renderMathBlock(block, isEditable));
                    if (window.Editor) window.Editor.savePage();
                }
            });
            
            wrapper.appendChild(input);
            wrapper.appendChild(renderBtn);
            setTimeout(() => input.focus(), 0);
        } else {
            // Render the equation
            const mathContainer = document.createElement('div');
            mathContainer.className = 'math-container';
            
            // Check if KaTeX is available
            if (typeof katex !== 'undefined') {
                try {
                    katex.render(content.text || '', mathContainer, {
                        displayMode: content.displayMode !== false,
                        throwOnError: false
                    });
                } catch (err) {
                    mathContainer.innerHTML = `<span style="color: red;">Error: ${err.message}</span>`;
                }
            } else {
                // Fallback: show LaTeX code
                mathContainer.innerHTML = `<code style="font-family: monospace; background: var(--bg-secondary); padding: 8px; border-radius: 4px;">${escapeHtml(content.text || '')}</code>`;
            }
            
            wrapper.appendChild(mathContainer);
            
            if (isEditable) {
                const editBtn = document.createElement('button');
                editBtn.className = 'ai-image-btn';
                editBtn.textContent = 'Edit';
                editBtn.style.marginTop = '8px';
                editBtn.addEventListener('click', () => {
                    block.content = { ...content, text: '' };
                    wrapper.innerHTML = '';
                    wrapper.appendChild(renderMathBlock(block, isEditable));
                });
                wrapper.appendChild(editBtn);
            }
        }
        
        return wrapper;
    }
    
    /**
     * Render an image block
     */
    function renderImageBlock(block, isEditable = true) {
        const wrapper = document.createElement('div');
        wrapper.className = 'block-content';
        
        if (block.content && block.content.url) {
            const imgWrapper = document.createElement('div');
            imgWrapper.className = 'image-wrapper';
            
            const img = document.createElement('img');
            img.src = block.content.url;
            img.alt = block.content.caption || '';
            img.draggable = false;
            
            // Handle image load errors
            img.addEventListener('error', () => {
                imgWrapper.innerHTML = `
                    <div style="padding: 48px; background: var(--bg-secondary); text-align: center; color: var(--text-muted);">
                        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-bottom: 12px;">
                            <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                            <circle cx="8.5" cy="8.5" r="1.5"></circle>
                            <polyline points="21 15 16 10 5 21"></polyline>
                        </svg>
                        <div>Image failed to load</div>
                    </div>
                `;
            });
            
            imgWrapper.appendChild(img);
            wrapper.appendChild(imgWrapper);
            
            if (isEditable) {
                const caption = document.createElement('input');
                caption.className = 'image-caption';
                caption.placeholder = 'Write a caption...';
                caption.value = block.content.caption || '';
                caption.addEventListener('input', () => {
                    block.content = { ...block.content, caption: caption.value };
                });
                wrapper.appendChild(caption);
            }
        } else if (isEditable) {
            const placeholder = document.createElement('div');
            placeholder.className = 'image-upload-placeholder';
            placeholder.innerHTML = `
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                    <circle cx="8.5" cy="8.5" r="1.5"></circle>
                    <polyline points="21 15 16 10 5 21"></polyline>
                </svg>
                <div>Click to upload or paste image URL</div>
            `;
            
            placeholder.addEventListener('click', () => {
                // Show options: URL input or file upload
                const option = confirm('Click OK to enter URL, Cancel to upload file');
                if (option) {
                    const url = prompt('Enter image URL:');
                    if (url) {
                        block.content = { url, caption: '' };
                        // Re-render
                        wrapper.innerHTML = '';
                        const newContent = renderImageBlock(block, isEditable);
                        wrapper.appendChild(newContent);
                    }
                } else {
                    // Create hidden file input
                    const fileInput = document.createElement('input');
                    fileInput.type = 'file';
                    fileInput.accept = 'image/*';
                    fileInput.style.display = 'none';
                    fileInput.addEventListener('change', (e) => {
                        const file = e.target.files[0];
                        if (file) {
                            const reader = new FileReader();
                            reader.onload = (event) => {
                                block.content = { url: event.target.result, caption: '' };
                                wrapper.innerHTML = '';
                                const newContent = renderImageBlock(block, isEditable);
                                wrapper.appendChild(newContent);
                            };
                            reader.readAsDataURL(file);
                        }
                    });
                    document.body.appendChild(fileInput);
                    fileInput.click();
                    document.body.removeChild(fileInput);
                }
            });
            
            wrapper.appendChild(placeholder);
        }
        
        return wrapper;
    }
    
    /**
     * Render an AI Image block
     */
    function renderAIImageBlock(block, isEditable = true) {
        const wrapper = document.createElement('div');
        wrapper.className = 'block-content ai-image-block';
        
        const content = typeof block.content === 'object' ? block.content : {
            prompt: '',
            imageUrl: null,
            model: DEFAULT_IMAGE_MODEL,
            size: '1024x1024',
            quality: 'standard',
            style: 'vivid',
            status: 'pending'
        };
        
        // Ensure block content is properly initialized
        if (typeof block.content !== 'object') {
            block.content = content;
        }
        
        // Show generated image if available
        if (content.imageUrl && content.status === 'done') {
            const imgContainer = document.createElement('div');
            imgContainer.className = 'ai-image-container';
            
            const imgWrapper = document.createElement('div');
            imgWrapper.className = 'ai-image-wrapper';
            
            const img = document.createElement('img');
            img.src = content.imageUrl;
            img.alt = content.prompt || 'AI generated image';
            img.className = 'ai-image';
            
            img.addEventListener('error', () => {
                imgWrapper.innerHTML = `
                    <div class="ai-image-error">
                        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                            <circle cx="8.5" cy="8.5" r="1.5"></circle>
                            <polyline points="21 15 16 10 5 21"></polyline>
                        </svg>
                        <div>Image failed to load</div>
                    </div>
                `;
            });
            
            imgWrapper.appendChild(img);
            imgContainer.appendChild(imgWrapper);
            
            // Model indicator
            const modelBadge = document.createElement('div');
            modelBadge.className = 'ai-image-model-badge';
            modelBadge.textContent = `Generated with ${content.model}`;
            imgContainer.appendChild(modelBadge);
            
            // Prompt display
            const promptDisplay = document.createElement('div');
            promptDisplay.className = 'ai-image-prompt-display';
            promptDisplay.innerHTML = `<strong>Prompt:</strong> ${escapeHtml(content.prompt)}`;
            imgContainer.appendChild(promptDisplay);
            
            // Actions
            const actions = document.createElement('div');
            actions.className = 'ai-image-actions';
            
            const regenerateBtn = document.createElement('button');
            regenerateBtn.className = 'ai-image-btn';
            regenerateBtn.innerHTML = '🔄 Regenerate';
            regenerateBtn.addEventListener('click', () => {
                content.status = 'pending';
                content.imageUrl = null;
                wrapper.innerHTML = '';
                const newContent = renderAIImageBlock(block, isEditable);
                wrapper.appendChild(newContent);
            });
            
            const downloadBtn = document.createElement('a');
            downloadBtn.className = 'ai-image-btn primary';
            downloadBtn.href = content.imageUrl;
            downloadBtn.download = `ai-image-${Date.now()}.png`;
            downloadBtn.target = '_blank';
            downloadBtn.textContent = '⬇️ Download';
            
            actions.appendChild(regenerateBtn);
            actions.appendChild(downloadBtn);
            imgContainer.appendChild(actions);
            
            wrapper.appendChild(imgContainer);
            
            if (isEditable) {
                const caption = document.createElement('input');
                caption.className = 'image-caption';
                caption.placeholder = 'Write a caption...';
                caption.value = content.caption || '';
                caption.addEventListener('input', () => {
                    block.content.caption = caption.value;
                });
                wrapper.appendChild(caption);
            }
        } else if (content.status === 'generating') {
            // Show loading state
            const loading = document.createElement('div');
            loading.className = 'ai-image-loading';
            loading.innerHTML = `
                <div class="ai-image-spinner"></div>
                <div class="ai-image-loading-text">Generating image...</div>
                <div class="ai-image-loading-subtext">"${escapeHtml(content.prompt)}"</div>
            `;
            wrapper.appendChild(loading);
        } else if (content.status === 'error') {
            // Show error state
            const error = document.createElement('div');
            error.className = 'ai-image-error-state';
            error.innerHTML = `
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <circle cx="12" cy="12" r="10"></circle>
                    <line x1="12" y1="8" x2="12" y2="12"></line>
                    <line x1="12" y1="16" x2="12.01" y2="16"></line>
                </svg>
                <div>Failed to generate image</div>
                <button class="ai-image-btn retry-btn">Try Again</button>
            `;
            error.querySelector('.retry-btn').addEventListener('click', () => {
                content.status = 'pending';
                wrapper.innerHTML = '';
                const newContent = renderAIImageBlock(block, isEditable);
                wrapper.appendChild(newContent);
            });
            wrapper.appendChild(error);
        } else {
            // Show input form
            const form = document.createElement('div');
            form.className = 'ai-image-form';
            
            const promptInput = document.createElement('textarea');
            promptInput.className = 'ai-image-prompt-input';
            promptInput.placeholder = 'Describe the image you want to generate...';
            promptInput.value = content.prompt || '';
            promptInput.rows = 3;
            
            // Options row
            const optionsRow = document.createElement('div');
            optionsRow.className = 'ai-image-options';
            
            // Model selector
            const modelSelect = document.createElement('select');
            modelSelect.className = 'ai-image-select';
            modelSelect.innerHTML = `
                <option value="dall-e-3">DALL-E 3</option>
                <option value="dall-e-2">DALL-E 2</option>
            `;
            modelSelect.value = content.model || DEFAULT_IMAGE_MODEL;
            
            // Size selector
            const sizeSelect = document.createElement('select');
            sizeSelect.className = 'ai-image-select';
            sizeSelect.innerHTML = `
                <option value="1024x1024">1024×1024</option>
                <option value="1024x1792">1024×1792 (Portrait)</option>
                <option value="1792x1024">1792×1024 (Landscape)</option>
            `;
            sizeSelect.value = content.size || '1024x1024';
            
            // Quality selector
            const qualitySelect = document.createElement('select');
            qualitySelect.className = 'ai-image-select';
            qualitySelect.innerHTML = `
                <option value="standard">Standard</option>
                <option value="hd">HD</option>
            `;
            qualitySelect.value = content.quality || 'standard';
            
            // Style selector
            const styleSelect = document.createElement('select');
            styleSelect.className = 'ai-image-select';
            styleSelect.innerHTML = `
                <option value="vivid">Vivid</option>
                <option value="natural">Natural</option>
            `;
            styleSelect.value = content.style || 'vivid';
            
            optionsRow.appendChild(modelSelect);
            optionsRow.appendChild(sizeSelect);
            optionsRow.appendChild(qualitySelect);
            optionsRow.appendChild(styleSelect);
            
            // Buttons
            const buttons = document.createElement('div');
            buttons.className = 'ai-image-form-actions';
            
            const generateBtn = document.createElement('button');
            generateBtn.className = 'ai-image-btn primary';
            generateBtn.innerHTML = '✨ Generate Image';
            
            const cancelBtn = document.createElement('button');
            cancelBtn.className = 'ai-image-btn';
            cancelBtn.textContent = 'Cancel';
            cancelBtn.addEventListener('click', () => {
                if (window.Editor && window.Editor.deleteBlock) {
                    window.Editor.deleteBlock(block.id);
                }
            });
            
            generateBtn.addEventListener('click', async () => {
                const prompt = promptInput.value.trim();
                if (!prompt) return;
                
                // Update block content
                block.content = {
                    prompt,
                    model: modelSelect.value,
                    size: sizeSelect.value,
                    quality: qualitySelect.value,
                    style: styleSelect.value,
                    status: 'generating',
                    imageUrl: null
                };
                
                // Show loading
                wrapper.innerHTML = '';
                const loadingContent = renderAIImageBlock(block, isEditable);
                wrapper.appendChild(loadingContent);
                
                // Generate image
                try {
                    const result = await API.generateImage({
                        prompt,
                        model: block.content.model,
                        size: block.content.size,
                        quality: block.content.quality,
                        style: block.content.style
                    });
                    
                    block.content.imageUrl = result.url;
                    block.content.status = 'done';
                    
                    // Re-render with result
                    wrapper.innerHTML = '';
                    const newContent = renderAIImageBlock(block, isEditable);
                    wrapper.appendChild(newContent);
                    
                    // Save page
                    if (window.Editor) {
                        window.Editor.savePage();
                    }
                } catch (err) {
                    console.error('Image generation error:', err);
                    block.content.status = 'error';
                    wrapper.innerHTML = '';
                    const errorContent = renderAIImageBlock(block, isEditable);
                    wrapper.appendChild(errorContent);
                }
            });
            
            buttons.appendChild(generateBtn);
            buttons.appendChild(cancelBtn);
            
            form.appendChild(promptInput);
            form.appendChild(optionsRow);
            form.appendChild(buttons);
            wrapper.appendChild(form);
            
            // Auto-focus
            setTimeout(() => promptInput.focus(), 0);
        }
        
        return wrapper;
    }
    
    /**
     * Render a bookmark block
     */
    function renderBookmarkBlock(block, isEditable = true) {
        const wrapper = document.createElement('div');
        wrapper.className = 'block-content';
        
        if (block.content && block.content.url) {
            const card = document.createElement('a');
            card.className = 'bookmark-card';
            card.href = block.content.url;
            card.target = '_blank';
            card.rel = 'noopener noreferrer';
            
            const info = document.createElement('div');
            info.className = 'bookmark-info';
            
            const title = document.createElement('div');
            title.className = 'bookmark-title';
            title.textContent = block.content.title || block.content.url;
            
            const desc = document.createElement('div');
            desc.className = 'bookmark-description';
            desc.textContent = block.content.description || '';
            
            const urlDiv = document.createElement('div');
            urlDiv.className = 'bookmark-url';
            
            if (block.content.favicon) {
                const favicon = document.createElement('img');
                favicon.src = block.content.favicon;
                favicon.alt = '';
                favicon.onerror = () => favicon.style.display = 'none';
                urlDiv.appendChild(favicon);
            }
            
            const urlText = document.createElement('span');
            try {
                urlText.textContent = new URL(block.content.url).hostname;
            } catch {
                urlText.textContent = block.content.url;
            }
            urlDiv.appendChild(urlText);
            
            info.appendChild(title);
            info.appendChild(desc);
            info.appendChild(urlDiv);
            card.appendChild(info);
            
            if (block.content.image) {
                const imgDiv = document.createElement('div');
                imgDiv.className = 'bookmark-image';
                const img = document.createElement('img');
                img.src = block.content.image;
                img.alt = '';
                img.onerror = () => imgDiv.style.display = 'none';
                imgDiv.appendChild(img);
                card.appendChild(imgDiv);
            }
            
            wrapper.appendChild(card);
        } else if (isEditable) {
            const input = document.createElement('input');
            input.className = 'bookmark-input';
            input.placeholder = 'Paste link and press Enter...';
            
            input.addEventListener('keydown', async (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    const url = input.value.trim();
                    if (url) {
                        input.placeholder = 'Loading...';
                        input.disabled = true;
                        
                        try {
                            const data = await API.fetchBookmarkData(url);
                            block.content = data;
                            // Re-render
                            wrapper.innerHTML = '';
                            const newContent = renderBookmarkBlock(block, isEditable);
                            wrapper.appendChild(newContent);
                        } catch (err) {
                            input.placeholder = 'Error loading bookmark';
                            input.disabled = false;
                        }
                    }
                }
            });
            
            wrapper.appendChild(input);
        }
        
        return wrapper;
    }
    
    /**
     * Render an AI block
     */
    function renderAIBlock(block, isEditable = true) {
        const wrapper = document.createElement('div');
        wrapper.className = 'block-content';
        
        const content = typeof block.content === 'object' ? block.content : {
            prompt: block.content || '',
            result: null,
            model: null
        };
        
        // Ensure block content is object
        if (typeof block.content !== 'object') {
            block.content = content;
        }
        
        if (content.result) {
            // Show result
            const resultContainer = document.createElement('div');
            resultContainer.className = 'ai-block-result-container';
            
            // Model badge if available
            if (content.model) {
                const modelBadge = document.createElement('div');
                modelBadge.className = 'ai-block-model-badge';
                modelBadge.textContent = `Generated with ${content.model}`;
                resultContainer.appendChild(modelBadge);
            }
            
            const result = document.createElement('div');
            result.className = 'ai-block-result';
            // FIX: Use safe text extraction to avoid [object Object]
            const resultText = extractResponseText(content.result);
            result.textContent = resultText;
            resultContainer.appendChild(result);
            
            const actions = document.createElement('div');
            actions.className = 'ai-block-actions';
            
            const regenerateBtn = document.createElement('button');
            regenerateBtn.className = 'ai-block-btn';
            regenerateBtn.textContent = '🔄 Regenerate';
            regenerateBtn.addEventListener('click', async () => {
                content.result = null;
                wrapper.innerHTML = '';
                
                // Show loading
                const loading = document.createElement('div');
                loading.className = 'ai-block-loading';
                loading.innerHTML = '<div class="spinner"></div><span>Generating...</span>';
                wrapper.appendChild(loading);
                
                try {
                    // Get page's default model or use global default
                    const page = window.Editor?.getCurrentPage?.();
                    const model = content.model || page?.defaultModel || DEFAULT_MODEL;
                    
                    const result = await API.generate(content.prompt, model);
                    // FIX: Use safe text extraction
                    const responseText = extractResponseText(result);
                    content.result = responseText;
                    content.model = model;
                    
                    // Re-render with result
                    wrapper.innerHTML = '';
                    const newContent = renderAIBlock(block, isEditable);
                    wrapper.appendChild(newContent);
                    
                    if (window.Editor) window.Editor.savePage();
                } catch (err) {
                    content.result = 'Error: ' + err.message;
                    wrapper.innerHTML = '';
                    const newContent = renderAIBlock(block, isEditable);
                    wrapper.appendChild(newContent);
                }
            });
            
            const insertBtn = document.createElement('button');
            insertBtn.className = 'ai-block-btn primary';
            insertBtn.textContent = 'Insert below';
            insertBtn.addEventListener('click', () => {
                if (window.Editor && window.Editor.insertBlockAfter) {
                    const resultText = extractResponseText(content.result);
                    window.Editor.insertBlockAfter(block.id, 'text', resultText);
                }
            });
            
            actions.appendChild(regenerateBtn);
            actions.appendChild(insertBtn);
            resultContainer.appendChild(actions);
            wrapper.appendChild(resultContainer);
        } else {
            // Show input
            const formContainer = document.createElement('div');
            formContainer.className = 'ai-block-form';
            
            const promptInput = document.createElement('textarea');
            promptInput.className = 'ai-block-prompt';
            promptInput.placeholder = 'Ask AI to write something...';
            promptInput.rows = 2;
            promptInput.value = content.prompt || '';
            
            // Model selector
            const modelRow = document.createElement('div');
            modelRow.className = 'ai-block-model-row';
            
            const modelLabel = document.createElement('span');
            modelLabel.textContent = 'Model:';
            
            const modelSelect = document.createElement('select');
            modelSelect.className = 'ai-block-model-select';
            
            // Populate models (async)
            API.getModels().then(models => {
                const page = window.Editor?.getCurrentPage?.();
                const defaultModel = content.model || page?.defaultModel || DEFAULT_MODEL;
                
                models.forEach(m => {
                    const option = document.createElement('option');
                    option.value = m.id;
                    option.textContent = m.name;
                    modelSelect.appendChild(option);
                });
                
                modelSelect.value = defaultModel;
            });
            
            modelRow.appendChild(modelLabel);
            modelRow.appendChild(modelSelect);
            
            const actions = document.createElement('div');
            actions.className = 'ai-block-actions';
            
            const generateBtn = document.createElement('button');
            generateBtn.className = 'ai-block-btn primary';
            generateBtn.innerHTML = '✨ Generate';
            
            const cancelBtn = document.createElement('button');
            cancelBtn.className = 'ai-block-btn';
            cancelBtn.textContent = 'Cancel';
            cancelBtn.addEventListener('click', () => {
                if (window.Editor && window.Editor.deleteBlock) {
                    window.Editor.deleteBlock(block.id);
                }
            });
            
            generateBtn.addEventListener('click', async () => {
                const prompt = promptInput.value.trim();
                if (!prompt) return;
                
                const selectedModel = modelSelect.value;
                block.content = { prompt, model: selectedModel };
                
                // Show loading
                wrapper.innerHTML = '';
                const loading = document.createElement('div');
                loading.className = 'ai-block-loading';
                loading.innerHTML = '<div class="spinner"></div><span>Generating...</span>';
                wrapper.appendChild(loading);
                
                try {
                    const result = await API.generate(prompt, selectedModel);
                    // FIX: Use safe text extraction to avoid [object Object]
                    const responseText = extractResponseText(result);
                    block.content.result = responseText;
                    block.content.model = selectedModel;
                    
                    // Re-render with result
                    wrapper.innerHTML = '';
                    const newContent = renderAIBlock(block, isEditable);
                    wrapper.appendChild(newContent);
                    
                    if (window.Editor) window.Editor.savePage();
                } catch (err) {
                    block.content.result = 'Error: ' + err.message;
                    wrapper.innerHTML = '';
                    const newContent = renderAIBlock(block, isEditable);
                    wrapper.appendChild(newContent);
                }
            });
            
            actions.appendChild(generateBtn);
            actions.appendChild(cancelBtn);
            
            formContainer.appendChild(promptInput);
            formContainer.appendChild(modelRow);
            formContainer.appendChild(actions);
            wrapper.appendChild(formContainer);
            
            // Auto-focus
            setTimeout(() => promptInput.focus(), 0);
        }
        
        return wrapper;
    }
    
    /**
     * Render a database block
     */
    function renderDatabaseBlock(block, isEditable = true) {
        const wrapper = document.createElement('div');
        wrapper.className = 'block-content';
        
        const data = block.content || { columns: ['Name'], rows: [], sortColumn: null, sortDirection: 'asc' };
        
        const table = document.createElement('div');
        table.className = 'database-table';
        
        // Header with sorting
        const header = document.createElement('div');
        header.className = 'database-header';
        data.columns.forEach((col, index) => {
            const cell = document.createElement('div');
            cell.className = 'database-cell database-header-cell';
            cell.style.cursor = 'pointer';
            
            // Add sort indicator
            let sortIndicator = '';
            if (data.sortColumn === index) {
                sortIndicator = data.sortDirection === 'asc' ? ' ▲' : ' ▼';
                cell.style.fontWeight = '700';
            }
            cell.textContent = col + sortIndicator;
            
            cell.addEventListener('click', () => {
                // Toggle sort
                if (data.sortColumn === index) {
                    data.sortDirection = data.sortDirection === 'asc' ? 'desc' : 'asc';
                } else {
                    data.sortColumn = index;
                    data.sortDirection = 'asc';
                }
                
                // Sort rows
                if (data.rows && data.rows.length > 0) {
                    data.rows.sort((a, b) => {
                        const aVal = String(a[index] || '').toLowerCase();
                        const bVal = String(b[index] || '').toLowerCase();
                        if (aVal < bVal) return data.sortDirection === 'asc' ? -1 : 1;
                        if (aVal > bVal) return data.sortDirection === 'asc' ? 1 : -1;
                        return 0;
                    });
                }
                
                block.content = data;
                // Re-render
                wrapper.innerHTML = '';
                const newContent = renderDatabaseBlock(block, isEditable);
                wrapper.appendChild(newContent);
                if (window.Editor) window.Editor.savePage();
            });
            
            header.appendChild(cell);
        });
        table.appendChild(header);
        
        // Rows (editable)
        const rowsContainer = document.createElement('div');
        rowsContainer.className = 'database-rows';
        
        data.rows.forEach((row, rowIndex) => {
            const rowEl = document.createElement('div');
            rowEl.className = 'database-row';
            
            row.forEach((cellData, colIndex) => {
                const cellEl = document.createElement('div');
                cellEl.className = 'database-cell';
                
                if (isEditable) {
                    cellEl.contentEditable = true;
                    cellEl.textContent = cellData;
                    cellEl.addEventListener('blur', () => {
                        data.rows[rowIndex][colIndex] = cellEl.textContent;
                        block.content = data;
                        if (window.Editor) window.Editor.savePage();
                    });
                } else {
                    cellEl.textContent = cellData;
                }
                
                rowEl.appendChild(cellEl);
            });
            
            // Delete row button
            if (isEditable) {
                const deleteCell = document.createElement('div');
                deleteCell.className = 'database-cell database-action-cell';
                deleteCell.innerHTML = '×';
                deleteCell.style.cursor = 'pointer';
                deleteCell.style.color = 'var(--text-muted)';
                deleteCell.style.width = '30px';
                deleteCell.style.textAlign = 'center';
                deleteCell.title = 'Delete row';
                deleteCell.addEventListener('click', () => {
                    data.rows.splice(rowIndex, 1);
                    block.content = data;
                    wrapper.innerHTML = '';
                    const newContent = renderDatabaseBlock(block, isEditable);
                    wrapper.appendChild(newContent);
                    if (window.Editor) window.Editor.savePage();
                });
                rowEl.appendChild(deleteCell);
            }
            
            rowsContainer.appendChild(rowEl);
        });
        
        table.appendChild(rowsContainer);
        
        // Add row button
        if (isEditable) {
            const addRow = document.createElement('div');
            addRow.className = 'database-add-row';
            addRow.textContent = '+ New';
            addRow.addEventListener('click', () => {
                data.rows.push(Array(data.columns.length).fill(''));
                block.content = data;
                // Re-render
                wrapper.innerHTML = '';
                const newContent = renderDatabaseBlock(block, isEditable);
                wrapper.appendChild(newContent);
                if (window.Editor) window.Editor.savePage();
            });
            table.appendChild(addRow);
            
            // Add column button
            const addCol = document.createElement('div');
            addCol.className = 'database-add-column';
            addCol.textContent = '+ Add Column';
            addCol.style.cssText = 'padding: 8px 12px; text-align: left; color: var(--text-muted); font-size: 13px; cursor: pointer; border-top: 1px solid var(--border-color);';
            addCol.addEventListener('click', () => {
                const colName = prompt('Column name:');
                if (colName) {
                    data.columns.push(colName);
                    // Add empty cell to each row
                    data.rows.forEach(row => row.push(''));
                    block.content = data;
                    wrapper.innerHTML = '';
                    const newContent = renderDatabaseBlock(block, isEditable);
                    wrapper.appendChild(newContent);
                    if (window.Editor) window.Editor.savePage();
                }
            });
            table.appendChild(addCol);
        }
        
        wrapper.appendChild(table);
        return wrapper;
    }
    
    /**
     * Format content with inline formatting
     */
    function formatContent(text, formatting = {}) {
        // Handle non-string inputs
        if (typeof text !== 'string') {
            if (text === null || text === undefined) return '';
            text = String(text);
        }
        
        // Escape HTML
        let html = text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
        
        // Apply formatting
        if (formatting.bold) {
            html = `<strong>${html}</strong>`;
        }
        if (formatting.italic) {
            html = `<em>${html}</em>`;
        }
        if (formatting.underline) {
            html = `<u>${html}</u>`;
        }
        if (formatting.strikethrough) {
            html = `<s>${html}</s>`;
        }
        if (formatting.code) {
            html = `<code>${html}</code>`;
        }
        
        // Convert URLs to links
        html = html.replace(
            /(https?:\/\/[^\s<]+)/g,
            '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>'
        );
        
        return html;
    }
    
    /**
     * Escape HTML special characters
     */
    function escapeHtml(text) {
        if (!text) return '';
        return text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }
    
    /**
     * Get all available block types
     */
    function getBlockTypes() {
        return BLOCK_TYPES;
    }
    
    /**
     * Get emojis for picker
     */
    function getEmojis(category = 'recent') {
        return EMOJIS[category] || EMOJIS.recent;
    }
    
    /**
     * Get emoji categories
     */
    function getEmojiCategories() {
        return Object.keys(EMOJIS);
    }
    
    /**
     * Parse markdown-style shortcuts
     */
    function parseMarkdown(text) {
        const shortcuts = [
            { pattern: /^#\s+(.+)$/, type: 'heading_1' },
            { pattern: /^##\s+(.+)$/, type: 'heading_2' },
            { pattern: /^###\s+(.+)$/, type: 'heading_3' },
            { pattern: /^[-*]\s+(.+)$/, type: 'bulleted_list' },
            { pattern: /^\d+\.\s+(.+)$/, type: 'numbered_list' },
            { pattern: /^\[([ x])\]\s*(.*)$/i, type: 'todo', parse: (m) => ({ text: m[2], checked: m[1].toLowerCase() === 'x' }) },
            { pattern: /^>\s+(.+)$/, type: 'quote' },
            { pattern: /^---+/, type: 'divider' },
            { pattern: /^```(.*)/, type: 'code', parse: (m) => ({ text: '', language: m[1] || 'plain' }) },
            { pattern: /^\$\$\s*$/, type: 'math', parse: () => ({ text: '', displayMode: true }) }
        ];
        
        for (const shortcut of shortcuts) {
            const match = text.match(shortcut.pattern);
            if (match) {
                if (shortcut.parse) {
                    return { type: shortcut.type, content: shortcut.parse(match) };
                }
                return { type: shortcut.type, content: match[1] };
            }
        }
        
        return null;
    }
    
    return {
        createBlock,
        getBlockTypes,
        getEmojis,
        getEmojiCategories,
        parseMarkdown,
        formatContent,
        getDefaultModel,
        getDefaultImageModel,
        extractResponseText,
        // Expose render functions for direct use
        render: {
            text: renderTextBlock,
            heading_1: renderTextBlock,
            heading_2: renderTextBlock,
            heading_3: renderTextBlock,
            bulleted_list: renderListBlock,
            numbered_list: renderListBlock,
            todo: renderTodoBlock,
            toggle: renderToggleBlock,
            quote: renderTextBlock,
            divider: renderDividerBlock,
            callout: renderCalloutBlock,
            code: renderCodeBlock,
            math: renderMathBlock,
            image: renderImageBlock,
            ai_image: renderAIImageBlock,
            bookmark: renderBookmarkBlock,
            database: renderDatabaseBlock,
            ai: renderAIBlock
        }
    };
})();
