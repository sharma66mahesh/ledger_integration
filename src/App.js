import React, { useEffect, useState } from 'react';
import Transport from '@ledgerhq/hw-transport-u2f';
import AppIcx from '@ledgerhq/hw-app-icx';
import swal from '@sweetalert/with-react';
import IconSDK, { IconAmount, HttpProvider, IconConverter, IconBuilder } from 'icon-sdk-js';

import { NETWORK_REF_TESTNET, NETWORK_REF_MAINNET, getNetwork } from './network';

const BASE_PATH = `44'/4801368'/0'/0'`;
const ALERT_TYPE_INFO = 'info';
const ADDRESSES_PER_PAGE = 5;
const INITIAL_ICON_PROVIDER = new HttpProvider(getNetwork(NETWORK_REF_TESTNET).apiEndpoint);
const SCORE_INSTALL_ADDRESS = 'cx0000000000000000000000000000000000000000';


function convertLoopToIcx(value) {
  return IconConverter.toBigNumber(
    IconAmount.of(value, IconAmount.Unit.LOOP).convertUnit(IconAmount.Unit.ICX)
  );
}



function Alert({ type, text, title, className, showIcon = true }) {
  return (
    <div className={`border-l-4 px-4 py-3 ${className || ''}`} role="alert">
      <div className="flex items-start">
        {showIcon && (
          <div className="flex-none text-3xl -mt-1 -ml-2 mr-2 opacity-75">
            {/* <FontAwesomeIcon icon={getIcon(type)} fixedWidth /> */}
            INFO!!
          </div>
        )}
        <div>
          {title && <div className="font-bold leading-tight">{title}</div>}
          {text && <div className="leading-tight">{text}</div>}
        </div>
      </div>
    </div>
  );
}



const App = () => {

  const [iconService, setIconService] = useState(new IconSDK(INITIAL_ICON_PROVIDER));

  const [icx, setIcx] = useState(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [isLoading, setIsLoading] = useState(false);
  const [wallets, setWallets] = useState([]);
  const [hasLedgerSupport, setHasLedgerSupport] = useState(true);

  useEffect(() => {
    // Setup transport and icx, attempt to connect to Ledger immediately
    setIsConnecting(true);
    Transport.create()
      .then(transport => {
        transport.setDebugMode(false);
        const icx = new AppIcx(transport);
        setIcx(icx);
        console.log("Transportation channel established!");
        return connectToLedger(icx, true);
      })
      .catch(error => {
        console.error("transport could not be established!");
        console.error(JSON.stringify(error));
        setError(error);
        setHasLedgerSupport(false);
        setIsConnecting(false);
      });
  }, []); // eslint-disable-line

  async function connectToLedger(icx, suppressError = false) {
    setIsConnecting(true);
    setError(null);
    try {
      const address = await icx.getAddress(`${BASE_PATH}/0'`, false, true);
      setIsConnected(true);
      setIsConnecting(false);

      const currentPage = 1;
      setCurrentPage(currentPage);
      loadWallets(icx, currentPage);
      console.log("Successfully connected to ledger");
    } catch (error) {
      console.error("Could not connect to ledger");
      console.error(JSON.stringify(error));
      if (suppressError) console.warn('Failed connecting to Ledger.', error.message);
      else setError(error);
      setIsConnected(false);
      setIsConnecting(false);
    }
  }


  async function loadWallets(icx, page) {
    swal({
      content: (
        <Alert
          type={ALERT_TYPE_INFO}
          title="Reading addresses from Ledger"
          text={
            <>
              Make sure your Ledger device is connected and unlocked with the <b>ICON</b> app
              running. You might see multiple browser messages relating to reading a security key.
            </>
          }
        />
      ),
      buttons: false,
      closeOnClickOutside: false,
      closeOnEsc: false,
    });

    setIsLoading(true);
    const offset = (page - 1) * ADDRESSES_PER_PAGE;
    const addresses = [];
    for (let i = offset; i < offset + ADDRESSES_PER_PAGE; i++) {
      const path = `${BASE_PATH}/${i}'`;
      let { address } = await icx.getAddress(path, false, true);
      address = address.toString();

      const availableBalance = await getBalance(address);
      const { staked, unstaking } = await getStake(address);
      const balance = availableBalance.plus(staked).plus(unstaking || 0);
      console.log(`Account: ${address}, Balance: ${availableBalance}, Staked: ${staked}`);
      addresses.push({ address, balance, path });
    }
    setWallets(addresses);
    setIsLoading(false);

    swal.close();
  }

  async function getBalance(address) {
    const balanceInLoops = await iconService.getBalance(address).execute();
    return convertLoopToIcx(balanceInLoops);
  }


  async function getStake(address) {
    const builder = new IconBuilder.CallBuilder();
    const getStakeCall = builder
      .to(SCORE_INSTALL_ADDRESS)
      .method('getStake')
      .params({ address })
      .build();
    const result = await iconService.call(getStakeCall).execute();

    return {
      staked: convertLoopToIcx(IconConverter.toBigNumber(result.stake)),
      unstaking: result.unstake
        ? convertLoopToIcx(IconConverter.toBigNumber(result.unstake))
        : null,
      remainingBlocks: result.remainingBlocks
        ? IconConverter.toBigNumber(result.remainingBlocks)
        : null,
    };
  }

  return(
    <div>
      Welcome!!
      {wallets.map((wallet, index) => <div key={index}>{JSON.stringify(wallet)}</div>)}
    </div>
  );

}

export default App;