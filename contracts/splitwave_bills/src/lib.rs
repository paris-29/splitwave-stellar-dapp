#![no_std]

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, symbol_short, vec, Address, Env, IntoVal,
    String,
};

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    TargetMustBePositive = 1,
    AmountMustBePositive = 2,
}

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Bill(String),
    Payment(String, Address),
}

#[contracttype]
#[derive(Clone)]
pub struct BillSummary {
    pub id: String,
    pub title: String,
    pub target: i128,
    pub paid: i128,
    pub contributors: u32,
    pub updated_ledger: u32,
}

#[contracttype]
#[derive(Clone)]
pub struct PaymentRecord {
    pub amount: i128,
    pub memo: String,
    pub updated_ledger: u32,
}

#[contract]
pub struct SplitwaveBills;

#[contractimpl]
impl SplitwaveBills {
    pub fn upsert_bill(
        env: Env,
        owner: Address,
        id: String,
        title: String,
        target: i128,
    ) -> Result<BillSummary, Error> {
        owner.require_auth();

        if target <= 0 {
            return Err(Error::TargetMustBePositive);
        }

        let key = DataKey::Bill(id.clone());
        let mut summary = read_bill(&env, id.clone());
        summary.title = title;
        summary.target = target;
        summary.updated_ledger = env.ledger().sequence();

        env.storage().persistent().set(&key, &summary);
        publish_bill_event(&env, id, owner, summary.target);

        Ok(summary)
    }

    pub fn record_payment(
        env: Env,
        bill_id: String,
        from: Address,
        amount: i128,
        memo: String,
    ) -> Result<BillSummary, Error> {
        let summary = write_payment(&env, bill_id.clone(), from.clone(), amount, memo)?;
        publish_payment_event(&env, bill_id, from, amount);

        Ok(summary)
    }

    pub fn record_payment_with_rewards(
        env: Env,
        bill_id: String,
        from: Address,
        amount: i128,
        memo: String,
        rewards_contract: Address,
    ) -> Result<BillSummary, Error> {
        let summary = write_payment(&env, bill_id.clone(), from.clone(), amount, memo)?;

        let _: u32 = env.invoke_contract(
            &rewards_contract,
            &symbol_short!("award"),
            vec![
                &env,
                bill_id.clone().into_val(&env),
                from.clone().into_val(&env),
                amount.into_val(&env),
            ],
        );

        publish_cross_payment_event(&env, bill_id, from, amount);

        Ok(summary)
    }

    pub fn summary(env: Env, bill_id: String) -> BillSummary {
        read_bill(&env, bill_id)
    }

    pub fn contribution(env: Env, bill_id: String, from: Address) -> PaymentRecord {
        read_payment(&env, bill_id, from)
    }
}

fn write_payment(
    env: &Env,
    bill_id: String,
    from: Address,
    amount: i128,
    memo: String,
) -> Result<BillSummary, Error> {
    from.require_auth();

    if amount <= 0 {
        return Err(Error::AmountMustBePositive);
    }

    let bill_key = DataKey::Bill(bill_id.clone());
    let payment_key = DataKey::Payment(bill_id.clone(), from.clone());
    let mut summary = read_bill(env, bill_id.clone());
    let mut payment = read_payment(env, bill_id, from);

    if payment.amount == 0 {
        summary.contributors += 1;
    }

    payment.amount += amount;
    payment.memo = memo;
    payment.updated_ledger = env.ledger().sequence();
    summary.paid += amount;
    summary.updated_ledger = env.ledger().sequence();

    env.storage().persistent().set(&payment_key, &payment);
    env.storage().persistent().set(&bill_key, &summary);

    Ok(summary)
}

#[allow(deprecated)]
fn publish_bill_event(env: &Env, id: String, owner: Address, target: i128) {
    env.events()
        .publish((symbol_short!("bill"), id, owner), target);
}

#[allow(deprecated)]
fn publish_payment_event(env: &Env, bill_id: String, from: Address, amount: i128) {
    env.events()
        .publish((symbol_short!("pay"), bill_id, from), amount);
}

#[allow(deprecated)]
fn publish_cross_payment_event(env: &Env, bill_id: String, from: Address, amount: i128) {
    env.events()
        .publish((symbol_short!("xpay"), bill_id, from), amount);
}

fn read_bill(env: &Env, bill_id: String) -> BillSummary {
    env.storage()
        .persistent()
        .get(&DataKey::Bill(bill_id.clone()))
        .unwrap_or(BillSummary {
            id: bill_id,
            title: String::from_str(env, "Daily bill"),
            target: 0,
            paid: 0,
            contributors: 0,
            updated_ledger: env.ledger().sequence(),
        })
}

fn read_payment(env: &Env, bill_id: String, from: Address) -> PaymentRecord {
    env.storage()
        .persistent()
        .get(&DataKey::Payment(bill_id, from))
        .unwrap_or(PaymentRecord {
            amount: 0,
            memo: String::from_str(env, ""),
            updated_ledger: env.ledger().sequence(),
        })
}

#[cfg(test)]
extern crate std;

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::{
        contract, contractimpl, contracttype, testutils::Address as _, Address, Env, String,
    };

    #[contracttype]
    #[derive(Clone)]
    enum RewardKey {
        Score(String, Address),
    }

    #[contract]
    struct RewardAudit;

    #[contractimpl]
    impl RewardAudit {
        #[allow(deprecated)]
        pub fn award(env: Env, bill_id: String, from: Address, amount: i128) -> u32 {
            let key = RewardKey::Score(bill_id.clone(), from.clone());
            let current = env.storage().persistent().get(&key).unwrap_or(0_u32);
            let earned = if amount >= 100 { amount / 100 } else { 1 } as u32;
            let next = current + earned;

            env.storage().persistent().set(&key, &next);
            env.events()
                .publish((symbol_short!("award"), bill_id, from), next);

            next
        }

        pub fn score(env: Env, bill_id: String, from: Address) -> u32 {
            env.storage()
                .persistent()
                .get(&RewardKey::Score(bill_id, from))
                .unwrap_or(0_u32)
        }
    }

    fn client(env: &Env) -> SplitwaveBillsClient<'static> {
        let contract_id = env.register(SplitwaveBills, ());
        SplitwaveBillsClient::new(env, &contract_id)
    }

    fn reward_client(env: &Env) -> (Address, RewardAuditClient<'static>) {
        let contract_id = env.register(RewardAudit, ());
        let client = RewardAuditClient::new(env, &contract_id);
        (contract_id, client)
    }

    fn bill_id(env: &Env) -> String {
        String::from_str(env, "daily-bills-orange")
    }

    #[test]
    fn upsert_bill_success() {
        let env = Env::default();
        let client = client(&env);
        let owner = Address::generate(&env);
        let id = bill_id(&env);
        let title = String::from_str(&env, "Orange belt dinner");

        let summary = client
            .mock_all_auths()
            .upsert_bill(&owner, &id, &title, &1_250);

        assert_eq!(summary.id, id);
        assert_eq!(summary.title, title);
        assert_eq!(summary.target, 1_250);
        assert_eq!(summary.paid, 0);
        assert_eq!(summary.contributors, 0);
    }

    #[test]
    fn record_payment_success() {
        let env = Env::default();
        let client = client(&env);
        let owner = Address::generate(&env);
        let payer = Address::generate(&env);
        let id = bill_id(&env);

        client
            .mock_all_auths()
            .upsert_bill(&owner, &id, &String::from_str(&env, "Dinner"), &1_250);

        let summary = client.mock_all_auths().record_payment(
            &id,
            &payer,
            &400,
            &String::from_str(&env, "noodles"),
        );

        assert_eq!(summary.id, id);
        assert_eq!(summary.target, 1_250);
        assert_eq!(summary.paid, 400);
        assert_eq!(summary.contributors, 1);
    }

    #[test]
    fn summary_returns_correct_data() {
        let env = Env::default();
        let client = client(&env);
        let owner = Address::generate(&env);
        let payer = Address::generate(&env);
        let id = bill_id(&env);
        let title = String::from_str(&env, "Weekend groceries");

        client
            .mock_all_auths()
            .upsert_bill(&owner, &id, &title, &2_000);
        client
            .mock_all_auths()
            .record_payment(&id, &payer, &650, &String::from_str(&env, "fruit"));

        let summary = client.summary(&id);

        assert_eq!(summary.id, id);
        assert_eq!(summary.title, title);
        assert_eq!(summary.target, 2_000);
        assert_eq!(summary.paid, 650);
        assert_eq!(summary.contributors, 1);
    }

    #[test]
    fn contribution_returns_correct_record() {
        let env = Env::default();
        let client = client(&env);
        let owner = Address::generate(&env);
        let payer = Address::generate(&env);
        let id = bill_id(&env);
        let memo = String::from_str(&env, "coffee");

        client
            .mock_all_auths()
            .upsert_bill(&owner, &id, &String::from_str(&env, "Cafe"), &700);
        client
            .mock_all_auths()
            .record_payment(&id, &payer, &250, &memo);

        let contribution = client.contribution(&id, &payer);

        assert_eq!(contribution.amount, 250);
        assert_eq!(contribution.memo, memo);
    }

    #[test]
    fn target_must_be_positive() {
        let env = Env::default();
        let client = client(&env);
        let owner = Address::generate(&env);
        let id = bill_id(&env);

        let result = client.mock_all_auths().try_upsert_bill(
            &owner,
            &id,
            &String::from_str(&env, "Invalid"),
            &0,
        );

        assert!(matches!(result, Err(Ok(Error::TargetMustBePositive))));
    }

    #[test]
    fn amount_must_be_positive() {
        let env = Env::default();
        let client = client(&env);
        let owner = Address::generate(&env);
        let payer = Address::generate(&env);
        let id = bill_id(&env);

        client
            .mock_all_auths()
            .upsert_bill(&owner, &id, &String::from_str(&env, "Dinner"), &1_000);

        let result = client.mock_all_auths().try_record_payment(
            &id,
            &payer,
            &0,
            &String::from_str(&env, "zero"),
        );

        assert!(matches!(result, Err(Ok(Error::AmountMustBePositive))));
    }

    #[test]
    fn multiple_payments_accumulate_correctly() {
        let env = Env::default();
        let client = client(&env);
        let owner = Address::generate(&env);
        let payer = Address::generate(&env);
        let id = bill_id(&env);

        client.mock_all_auths().upsert_bill(
            &owner,
            &id,
            &String::from_str(&env, "Utilities"),
            &3_000,
        );
        client
            .mock_all_auths()
            .record_payment(&id, &payer, &450, &String::from_str(&env, "power"));
        let summary = client.mock_all_auths().record_payment(
            &id,
            &payer,
            &550,
            &String::from_str(&env, "water"),
        );
        let contribution = client.contribution(&id, &payer);

        assert_eq!(summary.paid, 1_000);
        assert_eq!(summary.contributors, 1);
        assert_eq!(contribution.amount, 1_000);
        assert_eq!(contribution.memo, String::from_str(&env, "water"));
    }

    #[test]
    fn two_wallets_contribute_to_same_bill() {
        let env = Env::default();
        let client = client(&env);
        let owner = Address::generate(&env);
        let ari = Address::generate(&env);
        let mina = Address::generate(&env);
        let id = bill_id(&env);

        client.mock_all_auths().upsert_bill(
            &owner,
            &id,
            &String::from_str(&env, "Room bill"),
            &4_000,
        );
        client
            .mock_all_auths()
            .record_payment(&id, &ari, &900, &String::from_str(&env, "rent"));
        let summary = client.mock_all_auths().record_payment(
            &id,
            &mina,
            &1_100,
            &String::from_str(&env, "wifi"),
        );

        assert_eq!(summary.paid, 2_000);
        assert_eq!(summary.contributors, 2);
        assert_eq!(client.contribution(&id, &ari).amount, 900);
        assert_eq!(client.contribution(&id, &mina).amount, 1_100);
    }

    #[test]
    fn payment_with_rewards_calls_external_contract() {
        let env = Env::default();
        let client = client(&env);
        let (rewards_id, rewards) = reward_client(&env);
        let owner = Address::generate(&env);
        let payer = Address::generate(&env);
        let id = bill_id(&env);

        client.mock_all_auths().upsert_bill(
            &owner,
            &id,
            &String::from_str(&env, "Rewards bill"),
            &2_500,
        );

        let summary = client.mock_all_auths().record_payment_with_rewards(
            &id,
            &payer,
            &700,
            &String::from_str(&env, "rewarded"),
            &rewards_id,
        );

        assert_eq!(summary.paid, 700);
        assert_eq!(summary.contributors, 1);
        assert_eq!(rewards.score(&id, &payer), 7);
    }

    #[test]
    fn rewards_contract_accumulates_cross_contract_points() {
        let env = Env::default();
        let client = client(&env);
        let (rewards_id, rewards) = reward_client(&env);
        let owner = Address::generate(&env);
        let payer = Address::generate(&env);
        let id = bill_id(&env);

        client.mock_all_auths().upsert_bill(
            &owner,
            &id,
            &String::from_str(&env, "Rewards bill"),
            &2_500,
        );
        client.mock_all_auths().record_payment_with_rewards(
            &id,
            &payer,
            &700,
            &String::from_str(&env, "first"),
            &rewards_id,
        );
        client.mock_all_auths().record_payment_with_rewards(
            &id,
            &payer,
            &350,
            &String::from_str(&env, "second"),
            &rewards_id,
        );

        assert_eq!(client.summary(&id).paid, 1_050);
        assert_eq!(client.summary(&id).contributors, 1);
        assert_eq!(rewards.score(&id, &payer), 10);
    }
}
