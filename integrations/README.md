# Official Burp Suite MCP integration

TAB Copilot integrates with PortSwigger's official MCP Server extension:

- Repository: <https://github.com/PortSwigger/mcp-server>
- Pinned release: `v1.3.0`
- Release asset: `burp-mcp-all.jar`
- Expected SHA-256: `c4011245ee7da0cb901b9c0435aba3d8458ab5b0e2078e1a87fd025ed93c7892`
- Official Python MCP SDK: `mcp>=2.0.0,<3.0.0`

The previous custom Jython exporter has been removed. Burp connectivity now uses
the official PortSwigger extension and the official MCP Python SDK.

## 1. Install the official extension from the terminal

```bash
./scripts/install_portswigger_mcp.sh
```

The installer downloads only the pinned official GitHub release, verifies the
SHA-256 digest published by GitHub's release metadata, and installs it under:

```text
~/.local/share/tab-copilot/portswigger-mcp/current/burp-mcp-all.jar
```

Alternatively, install **MCP Server** directly from Burp's BApp Store. Do not
install similarly named third-party extensions.

## 2. Load and secure the extension in Burp

If using the downloaded JAR:

1. Open **Extensions → Installed → Add**.
2. Set extension type to **Java**.
3. Select `burp-mcp-all.jar` from the path printed by the installer.
4. Open Burp's **MCP** tab.
5. Keep the server bound to `127.0.0.1`; never bind it to `0.0.0.0` or a LAN
   interface.
6. Keep HTTP request approval enabled.
7. Keep data-access approval enabled.
8. Keep configuration-editing tools disabled.
9. Do not add wildcard auto-approved targets.
10. Keep the default local endpoint, normally `http://127.0.0.1:9876/sse`.

PortSwigger's extension applies its own approval dialogs. TAB Copilot applies a
second local approval gate before requesting history.

## 3. Verify the connection and tool policy

Start Burp and enable its MCP server, then run:

```bash
python tab_agent.py --burp-mcp-tools
```

The command lists every tool exposed by Burp and marks the copilot policy.
Only these read-only tools can pass the adapter:

- `get_proxy_http_history_regex`
- `get_organizer_items_regex`

The adapter blocks all other tools, including:

- `send_http1_request` and `send_http2_request`;
- `send_to_intruder`;
- Collaborator payload generation and polling;
- Repeater-tab creation;
- project/user configuration editing;
- task engine and proxy-intercept mutation;
- active editor mutation.

The allowlist cannot be expanded through `config.yaml`.

## 4. Import captured traffic through official MCP

Proxy history:

```bash
python tab_agent.py --live --burp-mcp-import proxy --max-imports 10
```

Organizer items:

```bash
python tab_agent.py --live --burp-mcp-import organizer --max-imports 10
```

The flow is:

1. TAB Copilot asks for explicit approval in the terminal.
2. The official PortSwigger MCP extension asks for data-access approval in Burp.
3. The copilot calls only the regex-filtered history tool.
4. The regex is fixed to the two exact TAB hosts.
5. Every returned request is independently checked for exact HTTPS scope and
   the required `-BugBounty-TA-31337` User-Agent suffix.
6. Traffic is redacted and stored locally.
7. No target request is sent, replayed, or modified.
8. AI is not invoked during history import.

Do not enable Burp's active scanner for this workflow. Imported Scanner findings
are intentionally not part of the MCP allowlist.

## 5. AI review agents

After a local finding exists, start the interactive copilot in live mode:

```bash
python tab_agent.py --live
```

Choose menu `9`. Available reviewer roles are:

- `triage` — facts versus hypotheses and false-positive risk;
- `scope_policy` — TAB scope and policy review;
- `cvss` — evidence-supported CVSS review;
- `report_quality` — report completeness and unsupported claims;
- `credential_policy` — exposed-secret policy only.

Each role requires a separate terminal approval and a separate LLM request.
The model receives only locally redacted finding/evidence context. AI output is
saved as notes and cannot call MCP tools, send HTTP traffic, modify Burp, change
CVSS, approve compliance, or edit reports automatically.

## HAR and generic JSON fallback

For browsers, OWASP ZAP, and tools that export HAR:

```bash
python tab_agent.py --import-file capture.har
```

Generic request/response JSON remains supported. File imports are capped at 20
exchanges, 20 MiB per file, and 2 MiB per message. Symlinks and out-of-scope or
non-compliant User-Agent captures are rejected.
