import yaml
import sys

def validate_k8s_yaml(filepath):
    valid = True
    try:
        with open(filepath, 'r') as f:
            docs = yaml.safe_load_all(f)
            for idx, doc in enumerate(docs):
                if doc is None:
                    continue
                kind = doc.get('kind')
                name = doc.get('metadata', {}).get('name', 'unknown')
                print(f"[{idx}] Validating {kind} '{name}'...")
                
                # Check Ingress specifically for the most common v1 schema errors
                if kind == 'Ingress':
                    rules = doc.get('spec', {}).get('rules', [])
                    for r_idx, rule in enumerate(rules):
                        paths = rule.get('http', {}).get('paths', [])
                        for p_idx, path in enumerate(paths):
                            backend = path.get('backend', {})
                            
                            # In networking.k8s.io/v1, backend must be backend.service.name / backend.service.port.number
                            if 'serviceName' in backend or 'servicePort' in backend:
                                print(f"  ❌ ERROR: Ingress '{name}' uses outdated v1beta1 backend format (serviceName/servicePort)")
                                valid = False
                            
                            service = backend.get('service', {})
                            if not service.get('name'):
                                print(f"  ❌ ERROR: Ingress '{name}' backend missing service.name")
                                valid = False
                            
                            port = service.get('port', {})
                            if not port.get('number') and not port.get('name'):
                                print(f"  ❌ ERROR: Ingress '{name}' backend missing service.port.number or name")
                                valid = False
                                
                            path_type = path.get('pathType')
                            if not path_type:
                                print(f"  ❌ ERROR: Ingress '{name}' rule {r_idx} path {p_idx} missing required 'pathType' (e.g. Prefix, Exact)")
                                valid = False
    except Exception as e:
        print(f"Parse error: {e}")
        valid = False
        
    sys.exit(0 if valid else 1)

if __name__ == "__main__":
    validate_k8s_yaml('kimibuilt-full-deploy.yaml')
