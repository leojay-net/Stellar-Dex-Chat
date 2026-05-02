use std::env;
use std::fs;
use std::path::Path;
use std::process::{Command, exit};

/// Deploy FiatBridge contract to Futurenet
/// 
/// Environment variables:
/// - FUTURENET_ADMIN_SECRET_KEY: Admin private key for Futurenet
/// - FUTURENET_RPC_URL: Futurenet RPC endpoint (default: https://rpc-futurenet.stellar.org)
/// - FUTURENET_NETWORK_PASSPHRASE: Futurenet passphrase (default: Test SDF Future Network ; April 2020)
/// - OUTPUT_FILE: File path for contract ID output (default: ./contract_id_futurenet.txt)
fn main() {
    let admin_secret = env::var("FUTURENET_ADMIN_SECRET_KEY")
        .expect("❌ FUTURENET_ADMIN_SECRET_KEY environment variable not set");
    
    let rpc_url = env::var("FUTURENET_RPC_URL")
        .unwrap_or_else(|_| "https://rpc-futurenet.stellar.org".to_string());
    
    let network_passphrase = env::var("FUTURENET_NETWORK_PASSPHRASE")
        .unwrap_or_else(|_| "Test SDF Future Network ; April 2020".to_string());
    
    let output_file = env::var("OUTPUT_FILE")
        .unwrap_or_else(|_| "./contract_id_futurenet.txt".to_string());

    println!("🚀 Deploying FiatBridge to Futurenet...");
    println!("   RPC URL: {}", rpc_url);
    println!("   Output file: {}", output_file);

    // Build the contract
    println!("📦 Building WASM contract...");
    let build_status = Command::new("cargo")
        .args(["build", "--target", "wasm32-unknown-unknown", "--release"])
        .status()
        .expect("Failed to build contract");

    if !build_status.success() {
        eprintln!("❌ Build failed");
        exit(1);
    }

    let wasm_path = "target/wasm32-unknown-unknown/release/stellar_contracts.wasm";
    if !Path::new(wasm_path).exists() {
        eprintln!("❌ WASM file not found at {}", wasm_path);
        exit(1);
    }

    // Deploy the contract
    println!("⚙️  Deploying contract to Futurenet...");
    let deploy_output = Command::new("soroban")
        .args([
            "contract", "deploy",
            "--wasm", wasm_path,
            "--secret-key", &admin_secret,
            "--network", "futurenet",
            "--rpc-url", &rpc_url,
            "--network-passphrase", &network_passphrase,
        ])
        .output()
        .expect("Failed to deploy contract");

    if !deploy_output.status.success() {
        eprintln!("❌ Deployment failed");
        eprintln!("stdout: {}", String::from_utf8_lossy(&deploy_output.stdout));
        eprintln!("stderr: {}", String::from_utf8_lossy(&deploy_output.stderr));
        exit(1);
    }

    // Extract contract ID from output
    let output_str = String::from_utf8_lossy(&deploy_output.stdout);
    let contract_id = output_str
        .lines()
        .find(|line| line.contains("Contract ID"))
        .and_then(|line| line.split_whitespace().last())
        .unwrap_or_else(|| {
            eprintln!("❌ Failed to extract contract ID from deployment output");
            exit(1);
        });

    println!("✅ Contract deployed successfully!");
    println!("   Contract ID: {}", contract_id);

    // Save contract ID to file
    if let Some(dir) = Path::new(&output_file).parent() {
        if !dir.as_os_str().is_empty() {
            fs::create_dir_all(dir).expect("Failed to create output directory");
        }
    }
    fs::write(&output_file, contract_id)
        .expect("Failed to write contract ID to file");

    println!("📝 Contract ID saved to: {}", output_file);
    println!("🎉 Deployment complete!");
}
