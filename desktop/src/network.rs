use mdns_sd::{IfKind, ServiceDaemon, ServiceInfo};
use serde::Serialize;
use std::net::{IpAddr, Ipv4Addr};

#[derive(Clone, Debug, Serialize, PartialEq)]
pub struct Address {
    pub name: String,
    pub address: String,
}

pub fn addresses() -> Vec<Address> {
    let mut result = vec![];
    for iface in netdev::get_interfaces() {
        let label = iface
            .friendly_name
            .clone()
            .unwrap_or_else(|| iface.name.clone());
        let description = format!(
            "{} {} {}",
            iface.name,
            label,
            iface.description.as_deref().unwrap_or("")
        )
        .to_lowercase();
        if !matches!(
            iface.if_type,
            netdev::interface::types::InterfaceType::Ethernet
                | netdev::interface::types::InterfaceType::Wireless80211
                | netdev::interface::types::InterfaceType::GigabitEthernet
                | netdev::interface::types::InterfaceType::FastEthernetT
                | netdev::interface::types::InterfaceType::FastEthernetFx
        ) {
            continue;
        }
        if !iface.is_up()
            || iface.is_loopback()
            || iface.is_point_to_point()
            || [
                "utun",
                "ipsec",
                "ppp",
                "vpn",
                "tun",
                "tap",
                "wireguard",
                "tailscale",
                "zerotier",
                "virtual",
                "veth",
                "docker",
                "vbox",
                "vmware",
                "hyper-v",
                "vethernet",
            ]
            .iter()
            .any(|s| description.contains(s))
        {
            continue;
        }
        #[cfg(target_os = "linux")]
        if !std::path::Path::new("/sys/class/net")
            .join(&iface.name)
            .join("device")
            .exists()
        {
            continue;
        }
        for ip in iface.ipv4 {
            let ip = ip.addr();
            if ip.is_private() {
                result.push(Address {
                    name: label.clone(),
                    address: ip.to_string(),
                });
            }
        }
    }
    result.sort_by(|a, b| a.name.cmp(&b.name).then(a.address.cmp(&b.address)));
    result.dedup();
    result
}

pub struct Bonjour {
    daemon: ServiceDaemon,
    fullname: Option<String>,
}
impl Bonjour {
    pub fn new() -> Result<Self, String> {
        Ok(Self {
            daemon: ServiceDaemon::new().map_err(|e| e.to_string())?,
            fullname: None,
        })
    }
    pub fn publish(&mut self, address: &str, port: u16) -> Result<(), String> {
        if let Some(name) = self.fullname.take() {
            let _ = self.daemon.unregister(&name);
        }
        if address.is_empty() {
            return Ok(());
        }
        let ip: Ipv4Addr = address.parse().map_err(|_| "address")?;
        let name = format!("efir-{}-{port}", address.replace('.', "-"));
        let mut info = ServiceInfo::new(
            "_efir._tcp.local.",
            &name,
            &format!("{name}.local."),
            IpAddr::V4(ip),
            port,
            [("version", env!("CARGO_PKG_VERSION"))].as_slice(),
        )
        .map_err(|e| e.to_string())?;
        info.set_interfaces(vec![IfKind::Addr(IpAddr::V4(ip))]);
        self.fullname = Some(info.get_fullname().to_string());
        self.daemon.register(info).map_err(|e| e.to_string())
    }
}
impl Drop for Bonjour {
    fn drop(&mut self) {
        let _ = self.daemon.shutdown();
    }
}
