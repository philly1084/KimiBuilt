/**
 * Notation Helper - Templates Module
 * Pre-built notation examples for various use cases
 */

const NotationTemplates = {
    // Template data
    templates: [
        // System Design
        {
            id: 'sys-auth-flow',
            name: 'Authentication Flow',
            category: 'system',
            description: 'User authentication with session management',
            notation: `user -> auth -> dashboard -> api -> db
auth --> email [verification]
session --stored-in--> redis`,
            mode: 'expand'
        },
        {
            id: 'sys-microservices',
            name: 'Microservices Architecture',
            category: 'system',
            description: 'Service interactions in a microservices setup',
            notation: `gateway -> [router] -> auth-svc | user-svc | order-svc
auth-svc --> db-auth
user-svc --> db-users
order-svc --> db-orders --> replica
order-svc --> payment-svc [async]`,
            mode: 'expand'
        },
        {
            id: 'sys-load-balancer',
            name: 'Load Balancer Setup',
            category: 'system',
            description: 'Multi-tier architecture with load balancing',
            notation: `client -> lb-nginx -> [app-1 | app-2 | app-3]
app-* -> cache-redis
app-* -> db-primary -> db-replica`,
            mode: 'expand'
        },
        
        // Flowcharts
        {
            id: 'flow-decision',
            name: 'Decision Flow',
            category: 'flowchart',
            description: 'Simple decision tree with yes/no branches',
            notation: `start -> [isValid?] -> yes -> process -> end
[isValid?] -> no -> error -> retry -> [isValid?]`,
            mode: 'explain'
        },
        {
            id: 'flow-payment',
            name: 'Payment Processing',
            category: 'flowchart',
            description: 'E-commerce payment flow with error handling',
            notation: `checkout -> [validate] -> valid -> charge -> [success?]
[success?] -> yes -> receipt -> fulfill -> end
[success?] -> no -> refund -> retry
[validate] -> invalid -> error -> end`,
            mode: 'explain'
        },
        {
            id: 'flow-user-reg',
            name: 'User Registration',
            category: 'flowchart',
            description: 'Complete user signup with email verification',
            notation: `signup -> [exists?] -> no -> create -> email -> [verified?]
[exists?] -> yes -> error
[verified?] -> yes -> activate -> welcome -> end
[verified?] -> no -> remind -> [expired?]
[expired?] -> yes -> cleanup -> end
[expired?] -> no -> email`,
            mode: 'explain'
        },
        
        // Data Models
        {
            id: 'data-blog',
            name: 'Blog Schema',
            category: 'data',
            description: 'Simple blog with users, posts, and comments',
            notation: `User { id: PK, email, username, created_at } --has-many--> Post { id: PK, title, content, status, user_id: FK }
User --has-many--> Comment { id: PK, body, post_id: FK, user_id: FK }
Post --has-many--> Comment
Post --has-many--> Tag { id: PK, name } via PostTag { post_id: FK, tag_id: FK }`,
            mode: 'expand'
        },
        {
            id: 'data-ecommerce',
            name: 'E-commerce Schema',
            category: 'data',
            description: 'Product catalog with orders and inventory',
            notation: `Product { id, name, price, sku, category_id: FK } --belongs-to--> Category { id, name, parent_id: FK }
Customer { id, email, name } --has-many--> Order { id, status, total, created_at }
Order --has-many--> OrderItem { id, quantity, price, product_id: FK }
OrderItem --belongs-to--> Product
Product --has-one--> Inventory { id, quantity, reserved }`,
            mode: 'expand'
        },
        {
            id: 'data-org',
            name: 'Organization Hierarchy',
            category: 'data',
            description: 'Company structure with departments and roles',
            notation: `Company { id, name } --has-many--> Department { id, name }
Department --has-many--> Team { id, name }
Team --has-many--> Employee { id, name, role, manager_id: FK }
Employee --belongs-to--> Employee [as manager]
Employee --has-many--> Project { id, name, status }
Employee --has-many--> Task { id, title, status }`,
            mode: 'expand'
        },
        
        // API Specs
        {
            id: 'api-rest',
            name: 'REST User API',
            category: 'api',
            description: 'Standard CRUD operations for users',
            notation: `GET    /api/users       -> 200 [User] | 401 { error }
GET    /api/users/:id   -> 200 { User } | 404 { error }
POST   /api/users       -> 201 { User } | 400 { error } | 409 { conflict }
PUT    /api/users/:id   -> 200 { User } | 400 { error } | 404 { error }
DELETE /api/users/:id   -> 204 | 404 { error }`,
            mode: 'expand'
        },
        {
            id: 'api-auth',
            name: 'Authentication API',
            category: 'api',
            description: 'Login, logout, and token refresh endpoints',
            notation: `POST /auth/login -> 200 { token, refreshToken, user } | 401 { error }
POST /auth/refresh -> 200 { token } | 401 { error }
POST /auth/logout -> 204 | 401 { error }
POST /auth/forgot -> 200 { message } | 404 { error }
POST /auth/reset/:token -> 200 { message } | 400 { error } | 410 { expired }`,
            mode: 'expand'
        },
        {
            id: 'api-graphql',
            name: 'GraphQL Schema',
            category: 'api',
            description: 'GraphQL types and operations',
            notation: `type User { id: ID!, name: String!, email: String!, posts: [Post!]! }
type Post { id: ID!, title: String!, content: String!, author: User! }
type Query { user(id: ID!): User, users: [User!]!, post(id: ID!): Post }
type Mutation { createUser(input: CreateUserInput!): User!, updateUser(id: ID!, input: UpdateUserInput!): User }`,
            mode: 'explain'
        },
        {
            id: 'api-webhooks',
            name: 'Webhook Events',
            category: 'api',
            description: 'Webhook event types and payloads',
            notation: `user.created    -> POST { id, email, created_at }
user.updated    -> POST { id, changes: [], updated_at }
user.deleted    -> POST { id, deleted_at }
payment.success -> POST { id, amount, currency, status }
payment.failed  -> POST { id, error, retryable }`,
            mode: 'explain'
        }
    ],

    /**
     * Get all templates
     * @returns {Array} All template objects
     */
    getAll() {
        return this.templates;
    },

    /**
     * Get templates by category
     * @param {string} category - Category filter ('all' for all templates)
     * @returns {Array} Filtered templates
     */
    getByCategory(category) {
        if (category === 'all') {
            return this.templates;
        }
        return this.templates.filter(t => t.category === category);
    },

    /**
     * Get a single template by ID
     * @param {string} id - Template ID
     * @returns {Object|null} Template object or null
     */
    getById(id) {
        return this.templates.find(t => t.id === id) || null;
    },

    /**
     * Get categories with counts
     * @returns {Array} Category objects with name and count
     */
    getCategories() {
        const counts = {};
        this.templates.forEach(t => {
            counts[t.category] = (counts[t.category] || 0) + 1;
        });
        
        const categoryNames = {
            'system': 'System Design',
            'flowchart': 'Flowcharts',
            'data': 'Data Models',
            'api': 'API Specs'
        };
        
        return Object.entries(counts).map(([key, count]) => ({
            id: key,
            name: categoryNames[key] || key,
            count
        }));
    },

    /**
     * Search templates by name or description
     * @param {string} query - Search query
     * @returns {Array} Matching templates
     */
    search(query) {
        const lowerQuery = query.toLowerCase();
        return this.templates.filter(t => 
            t.name.toLowerCase().includes(lowerQuery) ||
            t.description.toLowerCase().includes(lowerQuery) ||
            t.notation.toLowerCase().includes(lowerQuery)
        );
    },

    /**
     * Get category icon class
     * @param {string} category - Category ID
     * @returns {string} Font Awesome icon class
     */
    getCategoryIcon(category) {
        const icons = {
            'system': 'fas fa-server',
            'flowchart': 'fas fa-project-diagram',
            'data': 'fas fa-database',
            'api': 'fas fa-plug'
        };
        return icons[category] || 'fas fa-file-alt';
    },

    /**
     * Get category color
     * @param {string} category - Category ID
     * @returns {string} CSS color variable or hex
     */
    getCategoryColor(category) {
        const colors = {
            'system': '#3fb950',
            'flowchart': '#58a6ff',
            'data': '#a371f7',
            'api': '#f0883e'
        };
        return colors[category] || '#8b949e';
    }
};

// Export for module systems or make available globally
if (typeof module !== 'undefined' && module.exports) {
    module.exports = NotationTemplates;
}
