class RuntimeDiagnostics {
    constructor() {
        this.reset();
    }

    reset() {
        this.counters = {
            responseThreadChains: 0,
            artifactFollowupRecalls: 0,
            memoryHitMix: {
                fact: 0,
                artifact: 0,
                skill: 0,
                research: 0,
            },
            updatedAt: new Date().toISOString(),
        };
    }

    incrementResponseThreadChains() {
        this.counters.responseThreadChains += 1;
        this.counters.updatedAt = new Date().toISOString();
    }

    incrementArtifactFollowupRecalls() {
        this.counters.artifactFollowupRecalls += 1;
        this.counters.updatedAt = new Date().toISOString();
    }

    recordMemoryHitMix(hitMix = {}) {
        for (const key of Object.keys(this.counters.memoryHitMix)) {
            const value = Number(hitMix?.[key] || 0);
            if (Number.isFinite(value) && value > 0) {
                this.counters.memoryHitMix[key] += value;
            }
        }

        this.counters.updatedAt = new Date().toISOString();
    }

    snapshot() {
        return JSON.parse(JSON.stringify(this.counters));
    }
}

const runtimeDiagnostics = new RuntimeDiagnostics();

module.exports = {
    runtimeDiagnostics,
    RuntimeDiagnostics,
};
