"""Production entrypoint; never substitutes a simulated COS backend."""
from .production import main
if __name__ == "__main__":
 raise SystemExit(main())
