//! Local staging adapter; no WalletKit custody. Oxide owns enrollment authentication.
//! Share serialization/sealing follows Oxide's face_embedding_shares.rs.
//! ZKP challenge fetching and header construction call Oxide directly.
use anyhow::{ensure, Context, Result};
use base64::{engine::general_purpose::STANDARD as B64, Engine};
use serde::Deserialize;
use serde_json::json;
use std::io::{self, Read};
use std::str::FromStr;

#[derive(Deserialize)]
#[serde(tag = "operation", rename_all = "snake_case", deny_unknown_fields)]
enum Input {
    Shares {
        public_keys: [String; 3],
    },
    Authenticate {
        seed: String,
        kind: AuthenticationKind,
    },
    Verify {
        credential: String,
        sub: String,
        public_key: [String; 2],
    },
}

#[derive(Deserialize)]
#[serde(rename_all = "lowercase")]
enum AuthenticationKind {
    GetIdentity,
    UserCentricEnrollment,
}

async fn run() -> Result<()> {
    let mut text = String::new();
    io::stdin().take(262_145).read_to_string(&mut text)?;
    ensure!(text.len() <= 262_144, "input too large");
    let output = match serde_json::from_str::<Input>(&text)? {
        Input::Shares { public_keys } => {
            // A fresh synthetic int4 embedding. Never accepts a user's biometric input.
            let mut rng = rand::thread_rng();
            let embedding = ampc_secret_sharing::FaceVector::random_normalized(&mut rng);
            let shares = embedding
                .secret_share(&mut rng)
                .map_err(|_| anyhow::anyhow!("create AMPC shares"))?;
            let mut encrypted = Vec::new();
            for (share, key) in shares.iter().zip(public_keys) {
                let bytes: Vec<u8> = share
                    .0
                    .iter()
                    .flat_map(|value| value.to_le_bytes())
                    .collect();
                let encoded = serde_json::to_vec(
                    &json!({"version": "2.5", "share_data": B64.encode(bytes)}),
                )?;
                let key = B64.decode(key.trim()).context("decode staging PKI key")?;
                let key =
                    crypto_box::PublicKey::from_slice(&key).context("parse staging PKI key")?;
                let sealed = key
                    .seal(&mut rng, &encoded)
                    .map_err(|_| anyhow::anyhow!("seal AMPC share"))?;
                encrypted.push(B64.encode(sealed));
            }
            json!({"shares": encrypted})
        }
        Input::Authenticate { seed, kind } => {
            ensure!(
                seed.len() == 64 && seed.bytes().all(|c| c.is_ascii_hexdigit()),
                "invalid enrollment seed"
            );
            // Preserve the existing UTF-8 hex seed and identity_trapdoor domain.
            // Switching to IdentityContext::Face would change saved enrollment identities.
            let identity =
                oxide::identity::Identity::new(seed, oxide::identity_context::IdentityContext::Orb);
            let challenge_type = match kind {
                AuthenticationKind::GetIdentity => oxide::ChallengeType::GetIdentity,
                AuthenticationKind::UserCentricEnrollment => {
                    oxide::ChallengeType::UserCentricEnrollment
                }
            };
            let authentication = oxide::ZkpAuthentication::new(
                "https://app.stage.face.worldcoin.org".into(),
                "WorldApp/1.0.0 Oxide/1.0.0 iOS".into(),
            );
            let header = tokio::time::timeout(
                std::time::Duration::from_secs(80),
                authentication.create_header(&identity, challenge_type),
            )
            .await
            .context("enrollment authentication deadline expired")?
            .context("Oxide enrollment authentication failed")?;
            json!({"identityCommitment": identity.commitment().to_string(), "header": header})
        }
        Input::Verify {
            credential,
            sub,
            public_key,
        } => {
            let credential: world_id_primitives::Credential =
                serde_json::from_slice(&B64.decode(credential)?)?;
            let sub: world_id_primitives::FieldElement = sub
                .parse()
                .map_err(|_| anyhow::anyhow!("invalid subject"))?;
            let x = ark_babyjubjub::Fq::from_str(&public_key[0])
                .map_err(|_| anyhow::anyhow!("invalid issuer key"))?;
            let y = ark_babyjubjub::Fq::from_str(&public_key[1])
                .map_err(|_| anyhow::anyhow!("invalid issuer key"))?;
            let point = ark_babyjubjub::EdwardsAffine::new_unchecked(x, y);
            ensure!(
                !point.is_zero()
                    && point.is_on_curve()
                    && point.is_in_correct_subgroup_assuming_on_curve(),
                "invalid issuer key"
            );
            let key = world_id_primitives::EdDSAPublicKey { pk: point };
            ensure!(
                credential.issuer_schema_id == 11
                    && credential.sub == sub
                    && credential.issuer == key,
                "credential binding mismatch"
            );
            ensure!(
                credential
                    .verify_signature(&key)
                    .map_err(|_| anyhow::anyhow!("credential signature verification failed"))?,
                "invalid credential signature"
            );
            json!({"verified": true})
        }
    };
    println!("{}", serde_json::to_string(&output)?);
    Ok(())
}

#[tokio::main]
async fn main() {
    if let Err(error) = run().await {
        // Do not print serde input, identity material, or proof data on failure.
        let _ = error;
        eprintln!(
            "Staging face cryptography failed; check the helper input and pinned dependencies."
        );
        std::process::exit(1);
    }
}
