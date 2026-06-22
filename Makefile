SHELL := /bin/bash

WASM_PACK       ?= $(HOME)/.cargo/bin/wasm-pack
DATABASE_REPO   ?= https://github.com/JamesWP/database.git
DATABASE_DIR    ?= $(abspath ../database)
DATABASE_PKG    := $(DATABASE_DIR)/pkg
VENDOR_DIR      := vendor/database
PORT            ?= 8080

# ── clone ────────────────────────────────────────────────────────────────────

# Stamp lives in our tree (DATABASE_DIR may not be writable).
# The rule is a no-op if the repo already exists.
.stamps/database-clone:
	@mkdir -p .stamps
	@if [ ! -d "$(DATABASE_DIR)/.git" ]; then \
	  git clone $(DATABASE_REPO) $(DATABASE_DIR); \
	fi
	touch $@

.PHONY: clone-database
clone-database: .stamps/database-clone

# ── compile ───────────────────────────────────────────────────────────────────

# wasm-pack follows default-members, which points to the CLI binary (no lib
# target). Strip that line temporarily so it builds the root lib instead.
$(DATABASE_PKG)/database_bg.wasm: | .stamps/database-clone
	cd $(DATABASE_DIR) && \
	  sed -i '/^default-members/d' Cargo.toml && \
	  $(WASM_PACK) build --target web --release; \
	  status=$$?; \
	  git checkout -- Cargo.toml; \
	  exit $$status

.PHONY: build-database
build-database: $(DATABASE_PKG)/database_bg.wasm

# ── extract ───────────────────────────────────────────────────────────────────

$(VENDOR_DIR)/database_bg.wasm: $(DATABASE_PKG)/database_bg.wasm
	mkdir -p $(VENDOR_DIR)
	cp $(DATABASE_PKG)/database_bg.wasm \
	   $(DATABASE_PKG)/database.js \
	   $(DATABASE_PKG)/database.d.ts \
	   $(DATABASE_PKG)/database_bg.wasm.d.ts \
	   $(VENDOR_DIR)/

.PHONY: vendor-database
vendor-database: $(VENDOR_DIR)/database_bg.wasm

# ── top-level aliases ─────────────────────────────────────────────────────────

AWS4FETCH_VERSION ?= 1.0.20
AWS4FETCH_URL     := https://unpkg.com/aws4fetch@$(AWS4FETCH_VERSION)/dist/aws4fetch.esm.js
AWS4FETCH_OUT     := vendor/aws4fetch.js

$(AWS4FETCH_OUT):
	curl -sL $(AWS4FETCH_URL) -o $(AWS4FETCH_OUT)

.PHONY: vendor-aws4fetch
vendor-aws4fetch: $(AWS4FETCH_OUT)

# ── QR libraries ──────────────────────────────────────────────────────────────

QR_DIR            := vendor/qr
QRCODE_URL        := https://cdn.jsdelivr.net/npm/qrcode/+esm
DIJKSTRA_VERSION  ?= 1.0.3
DIJKSTRA_URL      := https://cdn.jsdelivr.net/npm/dijkstrajs@$(DIJKSTRA_VERSION)/+esm
JSQR_VERSION      ?= 1.4.0
JSQR_URL          := https://cdn.jsdelivr.net/npm/jsqr@$(JSQR_VERSION)/dist/jsQR.js

$(QR_DIR)/dijkstrajs.min.js:
	mkdir -p $(QR_DIR)
	curl -sL $(DIJKSTRA_URL) -o $@

# qrcode ESM references dijkstrajs via an absolute jsDelivr path; rewrite it
# to the local vendor file so the bundle works when served from any origin.
$(QR_DIR)/qrcode.min.js: $(QR_DIR)/dijkstrajs.min.js
	curl -sL $(QRCODE_URL) -o $@
	sed -i 's|from"/npm/dijkstrajs@$(DIJKSTRA_VERSION)/+esm"|from"./dijkstrajs.min.js"|' $@

$(QR_DIR)/jsQR.js:
	mkdir -p $(QR_DIR)
	curl -sL $(JSQR_URL) -o $@

.PHONY: vendor-qr
vendor-qr: $(QR_DIR)/qrcode.min.js $(QR_DIR)/jsQR.js

.PHONY: vendor
vendor: vendor-database vendor-aws4fetch vendor-qr

.PHONY: clean-vendor
clean-vendor:
	rm -rf $(VENDOR_DIR) $(AWS4FETCH_OUT) $(QR_DIR)

# ── serve ─────────────────────────────────────────────────────────────────────

.PHONY: serve
serve:
	python3 -m http.server $(PORT)

# ── test ──────────────────────────────────────────────────────────────────────

.PHONY: test
test:
	node --test test.js

# ── hooks ─────────────────────────────────────────────────────────────────────

.PHONY: install-hooks
install-hooks:
	cp hooks/pre-push .git/hooks/pre-push
	chmod +x .git/hooks/pre-push
