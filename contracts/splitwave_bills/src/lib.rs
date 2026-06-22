#![no_std]

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, symbol_short, Address, Env, String,
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
        env.events()
            .publish((symbol_short!("bill"), id, owner), summary.target);

        Ok(summary)
    }

    pub fn record_payment(
        env: Env,
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
        let mut summary = read_bill(&env, bill_id.clone());
        let mut payment = read_payment(&env, bill_id.clone(), from.clone());

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
        env.events()
            .publish((symbol_short!("pay"), bill_id, from), amount);

        Ok(summary)
    }

    pub fn summary(env: Env, bill_id: String) -> BillSummary {
        read_bill(&env, bill_id)
    }

    pub fn contribution(env: Env, bill_id: String, from: Address) -> PaymentRecord {
        read_payment(&env, bill_id, from)
    }
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
    use soroban_sdk::{testutils::Address as _, Address, Env, String};

    fn client(env: &Env) -> SplitwaveBillsClient<'static> {
        let contract_id = env.register(SplitwaveBills, ());
        SplitwaveBillsClient::new(env, &contract_id)
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
}
