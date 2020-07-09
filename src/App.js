import './App.css';
import React, { useEffect, useState } from 'react';
import Transport from '@ledgerhq/hw-transport-u2f';
import AppIcx from '@ledgerhq/hw-app-icx';
import swal from '@sweetalert/with-react';
import IconSDK, { IconAmount, HttpProvider, IconConverter, IconBuilder, IconUtil } from 'icon-sdk-js';

import { NETWORK_REF_TESTNET, NETWORK_REF_MAINNET, getNetwork } from './network';

const network = getNetwork(NETWORK_REF_TESTNET);

const API_VERSION = IconConverter.toBigNumber(3);
const BASE_PATH = `44'/4801368'/0'/0'`;
const ALERT_TYPE_INFO = 'info';
const ADDRESSES_PER_PAGE = 5;
const INITIAL_ICON_PROVIDER = new HttpProvider(network.apiEndpoint);
const SCORE_INSTALL_ADDRESS = 'cx0000000000000000000000000000000000000000';


function convertLoopToIcx(value) {
  return IconConverter.toBigNumber(
    IconAmount.of(value, IconAmount.Unit.LOOP).convertUnit(IconAmount.Unit.ICX)
  );
}

function convertIcxToLoop(value) {
  return IconAmount.of(value, IconAmount.Unit.ICX).toLoop();
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
  const [currWallet, setCurrWallet] = useState(null);
  const [hasLedgerSupport, setHasLedgerSupport] = useState(true);
  const [icxReceiver, setIcxReceiver] = useState("");
  const [color, setColor] = useState('RED');
  const [currColor, setCurrColor] = useState(null);

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


  const onSelectWallet = (wallet) => {
    console.log(`Selected: ${wallet.address}`);
    const newWallet = {
      getAddress: () => wallet.address,
      getPath: () => wallet.path
    };
    setCurrWallet(newWallet);
  }


  const sendIcx = async () => {
    if(currWallet && currWallet.getAddress()){
      const builder = new IconBuilder.IcxTransactionBuilder();
      const txObj = builder
        .nid(network.nid)
        .from(currWallet.getAddress())
        .to(icxReceiver)
        .value(convertIcxToLoop(0.0001))
        .stepLimit(IconConverter.toBigNumber(1000000))
        .version(API_VERSION)
        .timestamp(Date.now() * 1000)
        .build();
      
      const signedTransaction = await signTransaction(txObj, currWallet);
      return iconService.sendTransaction(signedTransaction).execute();
    } else {
      console.error("No wallet selected!");
    }
  }

  //helper
  const signTransaction = async (transaction, wallet) => {
    const rawTransaction = IconConverter.toRawTransaction(transaction);
    const hashKey = IconUtil.generateHashKey(rawTransaction);
    const transport = await Transport.create();
    const icx = new AppIcx(transport);
    const { signedRawTxBase64 } = await icx.signTransaction(wallet.getPath(), hashKey);
    rawTransaction.signature = signedRawTxBase64;
    return {
      getProperties: () => rawTransaction,
      getSignature: () => signedRawTxBase64
    };

  }

  //helper
  const sendTxToContract = async (contractAddr, from, methodName, paramsObj) => {
    const txObj = new IconBuilder.CallTransactionBuilder()
      .from(from)
      .to(contractAddr)
      .value(0)
      .stepLimit(IconConverter.toBigNumber(1000000))
      .nid(IconConverter.toBigNumber(3))
      .nonce(IconConverter.toBigNumber(1))
      .version(IconConverter.toBigNumber(3))
      .timestamp(new Date().getTime() * 1000)
      .method(methodName)
      .params(paramsObj)
      .build();
    
    const signedTransaction = await signTransaction(txObj, currWallet);
    return iconService.sendTransaction(signedTransaction).execute();
  }

  //helper
  const readContract = async (contractAddr, from, methodName, paramsObj) => {
    const callObj = new IconBuilder.CallBuilder()
      // .from(from)
      .to(contractAddr)
      .method(methodName)
      .params(paramsObj)
      .build();
    
    const callObjValue = await iconService.call(callObj).execute();
    console.log(callObjValue);
    setCurrColor(callObjValue);
  }


  const handleSendTx = (e) => {
    // const walletAddr = currWallet.getAddress();
    if(currWallet && currWallet.getAddress()) {
      sendTxToContract(
        'cxd9d1950dfdaad7fcc73a1803d1ea0fa0f6993a04',
        currWallet.getAddress(),
        'set_color',
        {
          "_color": color
        }
      )
    } else {
      console.error("No wallet selected!");
    }
  };

  const handleColorChange = (e) => {
    const newColor = e.target.value;
    setColor(() => newColor);
  }


  const handleContractCall = async () => {
    // const walletAddr = currWallet.getAddress();
    const walletAddr = 1;
    if(walletAddr) {
      await readContract(
        'cxd9d1950dfdaad7fcc73a1803d1ea0fa0f6993a04',
        walletAddr,
        'get_color',
        null
      );
    } else {
      console.error("No wallet selected!");
    }
  }


  return(
    <div>
      Welcome!! Click on one of the wallet addresses and start sending Tx.
      {wallets.map((wallet, index) => {
        return(
          <div key={index} onClick={() => onSelectWallet(wallet)}>
            {JSON.stringify(wallet)}
          </div>
        );
      })}

      <br />
      <br />

      <div>
        <input value={icxReceiver} placeholder="Receiver address (0.0001)" onChange={(e) => setIcxReceiver(e.target.value)} type='text' name='icxReceiver' />
        <button onClick={sendIcx}>Send ICX</button>
      </div>

      <div>
        <select value={color} onChange={handleColorChange} name="color" id="color">
          <option value="RED">Red</option>
          <option value="GREEN">Green</option>
          <option value="BLUE">Blue</option>
          <option value="YELLOW">Yellow</option>
        </select>
        <button onClick={handleSendTx}>Change Color</button>
      </div>
      <div>
        <button onClick={handleContractCall} >Read Color</button>
        {currColor ? <span style={{color: currColor}}>{currColor}</span> : null}
      </div>
    </div>
  );

}

export default App;